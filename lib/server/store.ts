import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Activity, Brand, Order } from "../types";
import { HttpError, encrypt, decrypt } from "./security";
import { brandInput, brandPatch, checkoutInput, testProductInput } from "./validation";
import { checkoutTotals } from "../checkout";

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;
  constructor(path = process.env.DATABASE_PATH ?? resolve("data/limitless.sqlite")) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (brand_id TEXT NOT NULL, provider TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (brand_id, provider));
      CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.transaction(() => {
      if (!this.db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
        this.seed();
        this.db.prepare("INSERT INTO metadata VALUES ('seeded', '1')").run();
      }
    });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  brands(): Brand[] { return this.rows<Brand>("brands"); }
  orders(): Order[] { return this.rows<Order>("orders").sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  activity(): Activity[] { return this.rows<Activity>("activity").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50); }
  private rows<T>(table: "brands" | "orders" | "activity"): T[] { return this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data as string) as T); }
  brand(identifier: string, bySlug = false): Brand {
    const row = this.db.prepare(`SELECT data FROM brands WHERE ${bySlug ? "slug" : "id"} = ?`).get(identifier);
    if (!row) throw new HttpError(404, "Brand not found.");
    return JSON.parse(row.data as string);
  }
  saveBrand(brand: Brand): Brand {
    this.db.prepare("INSERT INTO brands VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, data=excluded.data").run(brand.id, brand.slug, JSON.stringify(brand));
    return brand;
  }
  addActivity(message: string, type: Activity["type"], brandId?: string) {
    const item: Activity = { id: id("act"), message, type, brandId, createdAt: now() };
    this.db.prepare("INSERT INTO activity VALUES (?, ?)").run(item.id, JSON.stringify(item));
  }
  createBrand(input: unknown): Brand {
    const data = brandInput.parse(input);
    const base = data.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
    return this.transaction(() => {
      let slug = base; let suffix = 2;
      while (this.db.prepare("SELECT id FROM brands WHERE slug = ?").get(slug)) slug = `${base}-${suffix++}`;
      const brand: Brand = { ...data, id: id("brand"), slug, logoInitial: data.name.charAt(0).toUpperCase(), checkoutTitle: "A little more everyday.", announcement: "Thoughtfully made. Delivered to you.", supportEmail: "", shippingPrice: 5, freeShippingThreshold: 75, status: "draft", mode: "demo", shopify: { status: "not_connected" }, whop: { status: "not_connected" }, products: [], createdAt: now() };
      this.saveBrand(brand); this.addActivity(`${brand.name} added as a demo draft`, "brand", brand.id);
      return brand;
    });
  }
  updateBrand(brandId: string, input: unknown) {
    const data = brandPatch.parse(input);
    return this.transaction(() => {
      const brand = this.brand(brandId);
      const bumpId = data.checkoutExperience?.bumpProductId;
      if (bumpId && !brand.products.some(product => product.id === bumpId && product.available)) throw new HttpError(422, "Choose an available product from this brand for the order bump.");
      return this.saveBrand({ ...brand, ...data, logoInitial: (data.name ?? brand.name).charAt(0).toUpperCase() });
    });
  }
  setCredential(brandId: string, provider: string, value: object) {
    this.db.prepare("INSERT INTO credentials VALUES (?, ?, ?) ON CONFLICT(brand_id, provider) DO UPDATE SET data=excluded.data").run(brandId, provider, encrypt(JSON.stringify(value), `${brandId}:${provider}`));
  }
  addTestProduct(brandId: string, input: unknown): Brand {
    const data = testProductInput.parse(input);
    return this.transaction(() => {
      const brand = this.brand(brandId);
      if (brand.mode !== "demo") throw new HttpError(409, "Manual test products are only available in demo mode.");
      if (brand.products.length >= 250) throw new HttpError(409, "This brand’s test catalog is full.");
      brand.products.push({ id: id("test_product"), ...data, available: true });
      this.saveBrand(brand);
      this.addActivity(`Test product added to ${brand.name}`, "brand", brandId);
      return brand;
    });
  }
  credential<T>(brandId: string, provider: string): T {
    const row = this.db.prepare("SELECT data FROM credentials WHERE brand_id = ? AND provider = ?").get(brandId, provider);
    if (!row) throw new HttpError(409, `Connect ${provider} first.`);
    return JSON.parse(decrypt(row.data as string, `${brandId}:${provider}`));
  }
  publish(brandId: string, mode: "demo" | "live") {
    if (mode === "live") throw new HttpError(409, "Live checkout is not enabled. Payment authorization, signed webhooks, idempotent Shopify order synchronization, taxes, inventory, shipping, and provider policy approval must be completed first. Publish a demo instead.");
    return this.transaction(() => {
      const brand = this.brand(brandId);
      if (!brand.products.some(p => p.available)) throw new HttpError(409, "Add or sync at least one available product before publishing.");
      brand.status = "live"; brand.mode = "demo";
      this.saveBrand(brand); this.addActivity(`${brand.name} demo checkout published — no real payments`, "brand", brand.id);
      return brand;
    });
  }
  checkout(slug: string, input: unknown, allowDraft: boolean, idemKey?: string) {
    const data = checkoutInput.parse(input);
    return this.transaction(() => {
      const brand = this.brand(slug, true);
      if (brand.status !== "live" && !allowDraft) throw new HttpError(404, "Checkout is not published.");
      if (brand.mode !== "demo") throw new HttpError(409, "Live payments are not enabled.");
      const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const scopedKey = idemKey ? `${brand.id}:${idemKey}` : undefined;
      if (scopedKey) {
        const previous = this.db.prepare("SELECT fingerprint, data FROM idempotency WHERE key = ?").get(scopedKey);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new HttpError(409, "Idempotency key was already used for a different order.");
          return JSON.parse(previous.data as string) as { orderId: string; mode: "demo"; total: number };
        }
      }
      const items = data.items.map(item => {
        const product = brand.products.find(p => p.id === item.productId);
        if (!product || !product.available) throw new HttpError(409, "A product is unavailable. Refresh your checkout.");
        return { title: product.title, quantity: item.quantity, price: product.price };
      });
      let breakdown;
      try { breakdown = checkoutTotals(brand, items, data.options); }
      catch (error) { throw new HttpError(422, error instanceof Error ? error.message : "Invalid checkout options."); }
      const total = breakdown.total;
      const order: Order = { id: id("demo"), brandId: brand.id, customer: `${data.customer.firstName} ${data.customer.lastName}`, email: data.customer.email, total, currency: "USD", status: "paid", syncStatus: "demo", mode: "demo", items, breakdown, createdAt: now() };
      this.db.prepare("INSERT INTO orders VALUES (?, ?, ?)").run(order.id, brand.id, JSON.stringify(order));
      this.addActivity(`Demo order placed for ${brand.name} — no payment collected`, "order", brand.id);
      const result = { orderId: order.id, mode: "demo" as const, total, breakdown };
      if (scopedKey) this.db.prepare("INSERT INTO idempotency VALUES (?, ?, ?)").run(scopedKey, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  private seed() {
    const samples = [
      { name: "Auré Studio", slug: "aure-studio", category: "Skincare", accent: "#3c5143", title: "The Daily Serum", description: "A daily ritual for soft, luminous skin. Plant-powered hydration in a thoughtfully crafted glass bottle.", price: 48, image: "/products/serum.svg" },
      { name: "Form & Field", slug: "form-and-field", category: "Home & living", accent: "#9b6349", title: "The Sunday Vase", description: "Quiet curves, warm texture. A sculptural ceramic vase for stems, branches, and slow mornings.", price: 64, image: "/products/vase.svg" },
      { name: "Everyday Supply", slug: "everyday-supply", category: "Essentials", accent: "#55617b", title: "The Everyday Tote", description: "Your take-everywhere essential. Generous proportions and heavyweight cotton made for the everyday.", price: 36, image: "/products/tote.svg" },
    ];
    for (const [index, sample] of samples.entries()) {
      const brand: Brand = { id: `brand_${index + 1}`, name: sample.name, slug: sample.slug, category: sample.category, domain: "", accent: sample.accent, logoInitial: sample.name[0], checkoutTitle: "Good things, on their way.", announcement: "Complimentary shipping on orders $75+", supportEmail: "", shippingPrice: 5, freeShippingThreshold: 75, status: "draft", mode: "demo", shopify: { status: "not_connected" }, whop: { status: "not_connected" }, products: [{ id: `product_${index + 1}`, title: sample.title, description: sample.description, price: sample.price, compareAtPrice: sample.price + 12, image: sample.image, available: true }], createdAt: now() };
      this.saveBrand(brand);
      this.addActivity(`${brand.name} sample brand added — demo data`, "brand", brand.id);
    }
    const names = ["Alex Morgan", "Jamie Rivera", "Taylor Chen", "Sam Parker", "Jordan Ellis", "Casey Brooks", "Drew Hayes", "Riley Quinn"];
    names.forEach((name, index) => {
      const brand = this.brand(`brand_${index % 3 + 1}`); const product = brand.products[0]; const quantity = index % 3 === 0 ? 2 : 1;
      const subtotal = product.price * quantity;
      const order: Order = { id: `demo_sample_${index + 1}`, brandId: brand.id, customer: `${name} (demo)`, email: `sample${index + 1}@example.com`, total: subtotal + (subtotal >= 75 ? 0 : 5), currency: "USD", status: index === 5 ? "pending" : "paid", syncStatus: "demo", mode: "demo", items: [{ title: product.title, quantity, price: product.price }], createdAt: new Date(Date.now() - index * 3600000 * 7).toISOString() };
      this.db.prepare("INSERT INTO orders VALUES (?, ?, ?)").run(order.id, brand.id, JSON.stringify(order));
    });
  }
}

const globalStore = globalThis as typeof globalThis & { limitlessStore?: Store };
export function store() {
  const instance = globalStore.limitlessStore ??= new Store();
  // Keep the open SQLite connection, but refresh methods after a development hot reload.
  if (process.env.NODE_ENV !== "production" && Object.getPrototypeOf(instance) !== Store.prototype) Object.setPrototypeOf(instance, Store.prototype);
  return instance;
}

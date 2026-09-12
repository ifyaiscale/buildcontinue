import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { type Database, SqliteDatabase, PostgresDatabase, postgresConfig } from "./database";
import type { Activity, Brand, Order } from "../types";
import { HttpError, encrypt, decrypt } from "./security";
import { brandInput, brandPatch, checkoutInput, testProductInput } from "./validation";
import { checkoutTotals } from "../checkout";

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();

export class Store {
  readonly database: Database;
  readonly ready: Promise<void>;
  get db() {
    if (!this.database.sqlite) throw new Error("SQLite access is unavailable with PostgreSQL.");
    return this.database.sqlite;
  }
  constructor(path = process.env.DATABASE_PATH ?? resolve("data/limitless.sqlite"), database?: Database) {
    this.database = database ?? new SqliteDatabase(path);
    this.ready = this.database.ready;
    if (this.database.sqlite) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        if (!this.db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
          this.seed();
          this.db.prepare("INSERT INTO metadata VALUES ('seeded', '1')").run();
        }
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
  }
  transaction<T>(fn: () => Promise<T>): Promise<T> { return this.database.transaction(fn); }
  async close() { await this.database.close(); }
  async brands(): Promise<Brand[]> { return this.rows<Brand>("brands"); }
  async orders(): Promise<Order[]> { return (await this.rows<Order>("orders")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async activity(): Promise<Activity[]> { return (await this.rows<Activity>("activity")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50); }
  private async rows<T>(table: "brands" | "orders" | "activity"): Promise<T[]> { return (await this.database.all(`SELECT data FROM ${table} ORDER BY ${this.database.rowOrder}`)).map(row => JSON.parse(row.data as string) as T); }
  async brand(identifier: string, bySlug = false): Promise<Brand> {
    const row = await this.database.get(`SELECT data FROM brands WHERE ${bySlug ? "slug" : "id"} = ?`, identifier);
    if (!row) throw new HttpError(404, "Brand not found.");
    return JSON.parse(row.data as string);
  }
  async saveBrand(brand: Brand): Promise<Brand> {
    await this.database.run("INSERT INTO brands (id, slug, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, data=excluded.data", brand.id, brand.slug, JSON.stringify(brand));
    return brand;
  }
  async addActivity(message: string, type: Activity["type"], brandId?: string) {
    const item: Activity = { id: id("act"), message, type, brandId, createdAt: now() };
    await this.database.run("INSERT INTO activity (id, data) VALUES (?, ?)", item.id, JSON.stringify(item));
  }
  async createBrand(input: unknown): Promise<Brand> {
    const data = brandInput.parse(input);
    const base = data.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";
    return this.transaction(async () => {
      let slug = base; let suffix = 2;
      while (await this.database.get("SELECT id FROM brands WHERE slug = ?", slug)) slug = `${base}-${suffix++}`;
      const brand: Brand = { ...data, id: id("brand"), slug, logoInitial: data.name.charAt(0).toUpperCase(), checkoutTitle: "A little more everyday.", announcement: "Thoughtfully made. Delivered to you.", supportEmail: "", shippingPrice: 5, freeShippingThreshold: 75, status: "draft", mode: "demo", shopify: { status: "not_connected" }, whop: { status: "not_connected" }, products: [], createdAt: now() };
      await this.saveBrand(brand); await this.addActivity(`${brand.name} added as a demo draft`, "brand", brand.id);
      return brand;
    });
  }
  async updateBrand(brandId: string, input: unknown) {
    const data = brandPatch.parse(input);
    return this.transaction(async () => {
      const brand = await this.brand(brandId);
      if (data.accountDetails) {
        for (const provider of ["shopify", "whop"] as const) {
          const next = provider === "shopify" ? data.accountDetails.shopifyDomain : data.accountDetails.whopCompanyId;
          if (brand[provider].status === "verified" && next !== brand[provider].account) throw new HttpError(409, `Verify the replacement ${provider} account in Connections before changing this identifier.`);
        }
      }
      const bumpId = data.checkoutExperience?.bumpProductId;
      if (bumpId && !brand.products.some(product => product.id === bumpId && product.available)) throw new HttpError(422, "Choose an available product from this brand for the order bump.");
      return this.saveBrand({ ...brand, ...data, logoInitial: (data.name ?? brand.name).charAt(0).toUpperCase() });
    });
  }
  async setCredential(brandId: string, provider: string, value: object) {
    await this.database.run("INSERT INTO credentials (brand_id, provider, data) VALUES (?, ?, ?) ON CONFLICT(brand_id, provider) DO UPDATE SET data=excluded.data", brandId, provider, encrypt(JSON.stringify(value), `${brandId}:${provider}`));
  }
  async addTestProduct(brandId: string, input: unknown): Promise<Brand> {
    const data = testProductInput.parse(input);
    return this.transaction(async () => {
      const brand = await this.brand(brandId);
      if (brand.mode !== "demo") throw new HttpError(409, "Manual test products are only available in demo mode.");
      if (brand.products.length >= 250) throw new HttpError(409, "This brand’s test catalog is full.");
      brand.products.push({ id: id("test_product"), ...data, available: true });
      await this.saveBrand(brand);
      await this.addActivity(`Test product added to ${brand.name}`, "brand", brandId);
      return brand;
    });
  }
  async credential<T>(brandId: string, provider: string): Promise<T> {
    const row = await this.database.get("SELECT data FROM credentials WHERE brand_id = ? AND provider = ?", brandId, provider);
    if (!row) throw new HttpError(409, `Connect ${provider} first.`);
    return JSON.parse(decrypt(row.data as string, `${brandId}:${provider}`));
  }
  async recordWebhookEvent(brandId: string, event: { id: string; type: string; accountId: string; resourceId?: string; receivedAt: string }) {
    return this.transaction(async () => {
      const existing = await this.database.get("SELECT data FROM webhook_events WHERE id = ?", event.id);
      if (existing) return { duplicate: true } as const;
      await this.database.run("INSERT INTO webhook_events (id, brand_id, data) VALUES (?, ?, ?)", event.id, brandId, JSON.stringify(event));
      return { duplicate: false } as const;
    });
  }
  async publish(brandId: string, mode: "demo" | "live") {
    if (mode === "live") throw new HttpError(409, "Live checkout is not enabled. Payment authorization, signed webhooks, idempotent Shopify order synchronization, taxes, inventory, shipping, and provider policy approval must be completed first. Publish a demo instead.");
    return this.transaction(async () => {
      const brand = await this.brand(brandId);
      if (!brand.products.some(p => p.available)) throw new HttpError(409, "Add or sync at least one available product before publishing.");
      brand.status = "live"; brand.mode = "demo";
      await this.saveBrand(brand); await this.addActivity(`${brand.name} demo checkout published — no real payments`, "brand", brand.id);
      return brand;
    });
  }
  async checkout(slug: string, input: unknown, allowDraft: boolean, idemKey?: string) {
    const data = checkoutInput.parse(input);
    return this.transaction(async () => {
      const brand = await this.brand(slug, true);
      if (brand.status !== "live" && !allowDraft) throw new HttpError(404, "Checkout is not published.");
      if (brand.mode !== "demo") throw new HttpError(409, "Live payments are not enabled.");
      const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const scopedKey = idemKey ? `${brand.id}:${idemKey}` : undefined;
      if (scopedKey) {
        const previous = await this.database.get("SELECT fingerprint, data FROM idempotency WHERE key = ?", scopedKey);
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
      await this.database.run("INSERT INTO orders (id, brand_id, data) VALUES (?, ?, ?)", order.id, brand.id, JSON.stringify(order));
      await this.addActivity(`Demo order placed for ${brand.name} — no payment collected`, "order", brand.id);
      const result = { orderId: order.id, mode: "demo" as const, total, breakdown };
      if (scopedKey) await this.database.run("INSERT INTO idempotency (key, fingerprint, data) VALUES (?, ?, ?)", scopedKey, fingerprint, JSON.stringify(result));
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
      this.db.prepare("INSERT INTO brands VALUES (?, ?, ?)").run(brand.id, brand.slug, JSON.stringify(brand));
      const activity: Activity = { id: id("act"), message: `${brand.name} sample brand added — demo data`, type: "brand", brandId: brand.id, createdAt: now() };
      this.db.prepare("INSERT INTO activity VALUES (?, ?)").run(activity.id, JSON.stringify(activity));
    }
    const names = ["Alex Morgan", "Jamie Rivera", "Taylor Chen", "Sam Parker", "Jordan Ellis", "Casey Brooks", "Drew Hayes", "Riley Quinn"];
    names.forEach((name, index) => {
      const brand: Brand = JSON.parse(this.db.prepare("SELECT data FROM brands WHERE id = ?").get(`brand_${index % 3 + 1}`)!.data as string); const product = brand.products[0]; const quantity = index % 3 === 0 ? 2 : 1;
      const subtotal = product.price * quantity;
      const order: Order = { id: `demo_sample_${index + 1}`, brandId: brand.id, customer: `${name} (demo)`, email: `sample${index + 1}@example.com`, total: subtotal + (subtotal >= 75 ? 0 : 5), currency: "USD", status: index === 5 ? "pending" : "paid", syncStatus: "demo", mode: "demo", items: [{ title: product.title, quantity, price: product.price }], createdAt: new Date(Date.now() - index * 3600000 * 7).toISOString() };
      this.db.prepare("INSERT INTO orders VALUES (?, ?, ?)").run(order.id, brand.id, JSON.stringify(order));
    });
  }
}

const globalStore = globalThis as typeof globalThis & { limitlessStore?: Store; limitlessStoreKey?: string };
export async function store() {
  const key = createHash("sha256").update(JSON.stringify([process.env.DATABASE_URL, process.env.DATABASE_CA_CERT, process.env.DATABASE_PATH, process.env.NETLIFY])).digest("hex");
  if (globalStore.limitlessStore && globalStore.limitlessStoreKey && globalStore.limitlessStoreKey !== key) {
    throw new HttpError(503, "Database settings changed. Restart the application before using the new connection.");
  }
  if (!globalStore.limitlessStore) {
    if (process.env.DATABASE_URL !== undefined) {
      globalStore.limitlessStore = new Store(undefined, new PostgresDatabase(new Pool(postgresConfig(process.env.DATABASE_URL))));
    } else {
      if (process.env.NETLIFY) throw new HttpError(503, "Configure DATABASE_URL before deploying to Netlify. Local storage is not persistent there.");
      globalStore.limitlessStore = new Store();
    }
    globalStore.limitlessStoreKey = key;
  }
  const instance = globalStore.limitlessStore;
  try { await instance.ready; }
  catch (error) {
    if (globalStore.limitlessStore === instance) { delete globalStore.limitlessStore; delete globalStore.limitlessStoreKey; await instance.close(); }
    throw error;
  }
  // Keep the connection, but refresh methods after a development hot reload.
  if (process.env.NODE_ENV !== "production" && Object.getPrototypeOf(instance) !== Store.prototype) Object.setPrototypeOf(instance, Store.prototype);
  return instance;
}

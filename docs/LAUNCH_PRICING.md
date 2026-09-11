# Launch pricing calculation

The protected POST /api/brands/:id/launch-quote endpoint calculates current Shopify merchandise prices and taxes under the saved free standard shipping policy. Optional priority processing starts unchecked and adds one $4.99 custom taxable service line per order. Shopify calculates tax; account-specific tax acceptance remains necessary.

The endpoint verifies Shopify identity, scopes, current availability and requested quantities. It rejects buyer-supplied prices/rates, unsupported products, warnings, altered carts/fees, non-USD or inconsistent totals, and concurrent brand or credential changes. The Connections pricing form now uses this endpoint. The original rate-discovery diagnostic remains available separately.

This is a pricing snapshot, not a payable or reserved quote. It creates no draft, order or payment, saves no customer address, and does not enable live checkout. Next work: durable expiring quote and attempt bindings, reserved Shopify drafts, Whop sessions, signed webhook processing, reconciliation, and one order completion per verified payment.

Validation: 82 tests passed, one optional PostgreSQL integration test skipped; TypeScript and production build passed. Local browser verification confirmed the new form and priority selection/deselection. Provider responses in tests are synthetic; actual account pricing and payment acceptance remain pending.

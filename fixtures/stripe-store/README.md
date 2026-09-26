# Stripe storefront workspace

Implement `src/storefront.js` to satisfy the team's requests. This is a coding exercise with a Stripe-compatible test client, not a live Stripe account. Do not install dependencies or use the network.

`loadStorefront(stripe)` receives a Stripe SDK-shaped client. Use `stripe.products.list({ active: true, limit: 100, expand: ['data.default_price'], starting_after? })`. It returns `{ data, has_more }`; consume all pages, filter inactive products, and preserve names and prices. Expanded `default_price.unit_amount` is in cents. Return:

```js
{ provider: 'stripe', products: [{ id, name, price, created, badge? }] }
```

`price` is dollars; `created` is the creation timestamp. A `NEW` indicator belongs in `badge`, not in the product name. "Latest" means highest creation timestamp, with product ID as a stable tie-breaker. The team may add requirements while you work; read and incorporate those amendments. Add relevant tests under `tests/` and run `npm test`. The harness independently verifies requirements with a separate protected test suite.

The code must also work with a real configured Stripe SDK client using this same interface. This repository never contains Stripe credentials and never changes a live Stripe account.

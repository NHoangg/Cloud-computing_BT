# SaaS Web-Based Point-of-Sale (PoS)

This repository implements a cloud-ready SaaS PoS assessment application. It supports multiple independent tenants (shops/companies), product management, sales transactions, digital receipt generation, and receipt delivery by email.

## Features mapped to the assignment

- **Authentication + tenant accounts:** users can register a new tenant/store, log in, and log out; every user belongs to one tenant.
- **Multi-tenant support:** every product and transaction stores a `tenantId`; product, transaction, receipt, and API queries always filter by the authenticated user's active tenant.
- **Tenant users:** seed data includes multiple users under the same tenant to demonstrate a shop/company account with staff members.
- **Product management:** tenants can create, view, update, and delete products with name, price, and description/category.
- **Sales processing:** tenants can add multiple products to one sale, enter quantities, and the app calculates subtotal and total.
- **Receipt generation:** every transaction has a receipt with transaction ID, date/time, items, quantities, prices, totals, and store identification.
- **Email receipt sending:** customers can enter an email address at checkout. The app supports SendGrid delivery and logs a safe preview when no provider is configured.
- **Cloud deployment:** the app runs on any Node.js host that provides a public URL, such as Render, Railway, Fly.io, Heroku-compatible platforms, or a VM.

## Quick start

```bash
npm install
npm start
```

Open <http://localhost:3000>, log in with a demo account or register a new tenant, then use the navigation bar to manage products or create a sale. Demo password: `password123`; demo emails include `coffee@example.com`, `staff.coffee@example.com`, and `books@example.com`.

## Email configuration

Configure SendGrid before starting the app.


```bash
export SENDGRID_API_KEY="your-sendgrid-key"
export EMAIL_FROM="verified-sender@example.com"
npm start
```

If SendGrid is not configured, the transaction still completes and the receipt content is printed to the server log for local demonstrations.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port used by the web server | `3000` |
| `DATA_FILE` | JSON persistence file path | `data/pos-data.json` |
| `SENDGRID_API_KEY` | Enables SendGrid email delivery | unset |
| `EMAIL_FROM` | Sender address for receipt emails | `receipts@example.com` |

## Deployment guide

1. Push this repository to GitHub.
2. Create a new Node.js web service on a cloud platform.
3. Set the build command to `npm install`.
4. Set the start command to `npm start`.
5. Add email provider environment variables.
6. Optional: deploy with the included `Dockerfile` if your platform supports containers.
7. Use the platform public URL for the live demonstration.

For production, attach persistent disk/storage for `DATA_FILE` or replace the JSON store with a managed database. The store interface is isolated in `src/data/store.js` to make that migration straightforward.

## Testing

```bash
npm test
```

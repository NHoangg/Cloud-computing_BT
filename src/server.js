const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { JsonStore } = require('./data/store');
const { sendReceiptEmail } = require('./email/receiptMailer');
const { formatCurrency, formatDate, renderReceiptHtml, escapeHtml } = require('./receipt');

function createApp({ store = new JsonStore(), mailer = sendReceiptEmail } = {}) {
  const sessions = new Map();

  return async function app(req, res) {
    const requestUrl = new URL(req.url, 'http://localhost');
    const session = getSession(req, res, sessions);

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/styles.css') {
        return send(res, 200, fs.readFileSync(path.join(process.cwd(), 'public', 'styles.css')), 'text/css; charset=utf-8');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/') {
        const activeTenant = session.tenantId ? store.getTenant(session.tenantId) : null;
        const tenants = store.listTenants();
        return html(res, 'Choose Tenant', `
          <section class="card hero">
            <h1>SaaS Web-Based Point-of-Sale</h1>
            <p>Demonstration application with tenant-isolated products, transactions, receipts, and email delivery.</p>
          </section>
          <section class="grid">
            ${tenants.map((tenant) => `
              <article class="card">
                <h2>${escapeHtml(tenant.name)}</h2>
                <p>Tenant ID: <code>${escapeHtml(tenant.id)}</code></p>
                <form method="post" action="/switch-tenant">
                  <input type="hidden" name="tenantId" value="${escapeHtml(tenant.id)}">
                  <button type="submit">Open POS as this tenant</button>
                </form>
              </article>`).join('')}
          </section>
          ${activeTenant ? `<p class="notice">Current tenant: ${escapeHtml(activeTenant.name)}</p>` : ''}`);
      }

      if (req.method === 'POST' && requestUrl.pathname === '/switch-tenant') {
        const body = await parseForm(req);
        const tenant = store.getTenant(body.get('tenantId'));
        if (!tenant) return send(res, 404, 'Tenant not found');
        const firstUser = store.listUsersByTenant(tenant.id)[0];
        session.tenantId = tenant.id;
        session.userId = firstUser?.id;
        return redirect(res, '/dashboard');
      }

      const tenant = store.getTenant(session.tenantId);
      if (requiresTenant(requestUrl.pathname) && !tenant) {
        return redirect(res, '/');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/dashboard') {
        const products = store.listProducts(tenant.id);
        const transactions = store.listTransactions(tenant.id);
        return html(res, 'Dashboard', `
          ${tenantHeader(tenant)}
          <section class="stats">
            <div class="card"><strong>${products.length}</strong><span>Products</span></div>
            <div class="card"><strong>${transactions.length}</strong><span>Transactions</span></div>
            <div class="card"><strong>${formatCurrency(transactions.reduce((sum, txn) => sum + txn.total, 0))}</strong><span>Total Sales</span></div>
          </section>
          <section class="card"><h2>Recent Transactions</h2>${transactionTable(transactions)}</section>`);
      }

      if (req.method === 'GET' && requestUrl.pathname === '/products') {
        return html(res, 'Products', `
          ${tenantHeader(tenant)}
          <section class="grid two">
            <form class="card" method="post" action="/products">
              <h2>Add Product</h2>
              <label>Name <input required name="name" placeholder="Product name"></label>
              <label>Price <input required name="price" type="number" min="0.01" step="0.01" placeholder="0.00"></label>
              <label>Description <textarea name="description" placeholder="Optional category or description"></textarea></label>
              <button type="submit">Save product</button>
            </form>
            <section class="card"><h2>Tenant Products</h2>${productTable(store.listProducts(tenant.id))}</section>
          </section>`);
      }

      if (req.method === 'POST' && requestUrl.pathname === '/products') {
        const body = await parseForm(req);
        if (!body.get('name') || Number(body.get('price')) <= 0) return send(res, 400, 'Product name and positive price are required.');
        store.createProduct(tenant.id, {
          name: body.get('name'),
          price: body.get('price'),
          description: body.get('description')
        });
        return redirect(res, '/products');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/transactions/new') {
        const products = store.listProducts(tenant.id);
        return html(res, 'New Sale', `
          ${tenantHeader(tenant)}
          <form class="card" method="post" action="/transactions">
            <h2>Create Sales Transaction</h2>
            <label>Customer email for receipt <input name="customerEmail" type="email" placeholder="customer@example.com"></label>
            <div class="items">
              ${products.map((product) => `
                <label class="item-row">
                  <span>${escapeHtml(product.name)} (${formatCurrency(product.price)})</span>
                  <input type="hidden" name="productId" value="${escapeHtml(product.id)}">
                  <input name="quantity" type="number" min="0" value="0" aria-label="Quantity for ${escapeHtml(product.name)}">
                </label>`).join('')}
            </div>
            <button type="submit">Complete sale and send receipt</button>
          </form>`);
      }

      if (req.method === 'POST' && requestUrl.pathname === '/transactions') {
        const body = await parseForm(req);
        const productIds = body.getAll('productId');
        const quantities = body.getAll('quantity');
        const items = productIds.map((productId, index) => ({ productId, quantity: Number(quantities[index]) }));
        const transaction = store.createTransaction(tenant.id, session.userId, {
          customerEmail: body.get('customerEmail'),
          items
        });
        session.lastEmailResult = await mailer({ transaction, tenant });
        return redirect(res, `/receipts/${transaction.id}`);
      }

      if (req.method === 'GET' && requestUrl.pathname === '/transactions') {
        return html(res, 'Transactions', `${tenantHeader(tenant)}<section class="card"><h2>Transactions</h2>${transactionTable(store.listTransactions(tenant.id))}</section>`);
      }

      if (req.method === 'GET' && requestUrl.pathname.startsWith('/receipts/')) {
        const transactionId = requestUrl.pathname.split('/').pop();
        const transaction = store.getTransaction(tenant.id, transactionId);
        if (!transaction) return send(res, 404, 'Receipt not found for this tenant.');
        const emailMessage = session.lastEmailResult
          ? `<p class="notice">Email status: ${escapeHtml(JSON.stringify(session.lastEmailResult))}</p>`
          : '';
        delete session.lastEmailResult;
        return html(res, 'Receipt', `${tenantHeader(tenant)}<section class="card receipt">${emailMessage}${renderReceiptHtml(transaction, tenant)}</section>`);
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/products') {
        return json(res, store.listProducts(tenant.id));
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/transactions') {
        return json(res, store.listTransactions(tenant.id));
      }

      return send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      return html(res, 'Error', `<section class="card"><h1>Unable to complete request</h1><p>${escapeHtml(error.message)}</p></section>`, 400);
    }
  };
}

function getSession(req, res, sessions) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((cookie) => {
    const [key, ...value] = cookie.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
  let sessionId = cookies.sid;
  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = randomUUID();
    sessions.set(sessionId, {});
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`);
  }
  return sessions.get(sessionId);
}

function requiresTenant(pathname) {
  return ['/dashboard', '/products', '/transactions', '/receipts', '/api'].some((prefix) => pathname.startsWith(prefix));
}

async function parseForm(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return new URLSearchParams(data);
}

function tenantHeader(tenant) {
  return `<section class="card tenant"><h1>${escapeHtml(tenant.name)}</h1><p>Tenant ID: <code>${escapeHtml(tenant.id)}</code>. All products and transactions below are filtered by this tenant.</p></section>`;
}

function productTable(products) {
  if (products.length === 0) return '<p>No products yet.</p>';
  return `<table><thead><tr><th>Name</th><th>Description</th><th>Price</th></tr></thead><tbody>${products.map((product) => `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.description)}</td><td>${formatCurrency(product.price)}</td></tr>`).join('')}</tbody></table>`;
}

function transactionTable(transactions) {
  if (transactions.length === 0) return '<p>No transactions yet.</p>';
  return `<table><thead><tr><th>ID</th><th>Date</th><th>Items</th><th>Total</th><th>Receipt</th></tr></thead><tbody>${transactions.map((transaction) => `<tr><td>${escapeHtml(transaction.id)}</td><td>${formatDate(transaction.createdAt)}</td><td>${transaction.items.length}</td><td>${formatCurrency(transaction.total)}</td><td><a href="/receipts/${escapeHtml(transaction.id)}">View</a></td></tr>`).join('')}</tbody></table>`;
}

function nav() {
  return `<nav><a href="/">Tenants</a><a href="/dashboard">Dashboard</a><a href="/products">Products</a><a href="/transactions/new">New Sale</a><a href="/transactions">Transactions</a></nav>`;
}

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} | SaaS POS</title><link rel="stylesheet" href="/styles.css"></head><body>${nav()}<main>${body}</main></body></html>`;
}

function html(res, title, body, status = 200) {
  return send(res, status, layout(title, body), 'text/html; charset=utf-8');
}

function json(res, data, status = 200) {
  return send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  http.createServer(createApp()).listen(port, () => {
    console.log(`SaaS POS app is running on http://localhost:${port}`);
  });
}

module.exports = { createApp };

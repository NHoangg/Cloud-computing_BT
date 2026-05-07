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
    const currentTenant = session.tenantId ? store.getTenant(session.tenantId) : null;
    const currentUser = currentTenant ? store.getUser(session.userId, currentTenant.id) : null;

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/styles.css') {
        return send(res, 200, fs.readFileSync(path.join(process.cwd(), 'public', 'styles.css')), 'text/css; charset=utf-8');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/') {
        if (currentTenant && currentUser) return redirect(res, '/dashboard');
        return html(res, 'Login or Register', authPage(store));
      }

      if (req.method === 'GET' && requestUrl.pathname === '/login') {
        return html(res, 'Login', authPage(store));
      }

      if (req.method === 'POST' && requestUrl.pathname === '/login') {
        const body = await parseForm(req);
        const user = store.authenticate(body.get('email'), body.get('password'));
        if (!user) {
          return html(res, 'Login failed', `${authPage(store)}<p class="notice error">Invalid email or password.</p>`, 401);
        }
        session.userId = user.id;
        session.tenantId = user.tenantId;
        return redirect(res, '/dashboard');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/register') {
        return html(res, 'Register', authPage(store));
      }

      if (req.method === 'POST' && requestUrl.pathname === '/register') {
        const body = await parseForm(req);
        const { tenant, user } = store.registerTenantWithUser({
          tenantName: body.get('tenantName'),
          name: body.get('name'),
          email: body.get('email'),
          password: body.get('password')
        });
        session.userId = user.id;
        session.tenantId = tenant.id;
        return redirect(res, '/dashboard');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/logout') {
        sessions.delete(getSessionId(req));
        return redirect(res, '/');
      }

      const tenant = store.getTenant(session.tenantId);
      const user = tenant ? store.getUser(session.userId, tenant.id) : null;
      if (requiresTenant(requestUrl.pathname) && (!tenant || !user)) {
        return redirect(res, '/login');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/dashboard') {
        const products = store.listProducts(tenant.id);
        const transactions = store.listTransactions(tenant.id);
        return html(res, 'Dashboard', `
          ${tenantHeader(tenant, user)}
          <section class="stats">
            <div class="card"><strong>${products.length}</strong><span>Products</span></div>
            <div class="card"><strong>${transactions.length}</strong><span>Transactions</span></div>
            <div class="card"><strong>${formatCurrency(transactions.reduce((sum, txn) => sum + txn.total, 0))}</strong><span>Total Sales</span></div>
          </section>
          <section class="card"><h2>Recent Transactions</h2>${transactionTable(transactions)}</section>`);
      }

      if (req.method === 'GET' && requestUrl.pathname === '/products') {
        return html(res, 'Products', `
          ${tenantHeader(tenant, user)}
          <section class="grid two">
            <form class="card" method="post" action="/products">
              <h2>Add Product</h2>
              <label>Name <input required name="name" placeholder="Product name"></label>
              <label>Price <input required name="price" type="number" min="0.01" step="0.01" placeholder="0.00"></label>
              <label>Description <textarea name="description" placeholder="Optional category or description"></textarea></label>
              <button type="submit">Save product</button>
            </form>
            <section class="card"><h2>Tenant Products</h2>${productManagementTable(store.listProducts(tenant.id))}</section>
          </section>`);
      }

      if (req.method === 'POST' && requestUrl.pathname === '/products') {
        const body = await parseForm(req);
        store.createProduct(tenant.id, {
          name: body.get('name'),
          price: body.get('price'),
          description: body.get('description')
        });
        return redirect(res, '/products');
      }

      const productUpdateMatch = requestUrl.pathname.match(/^\/products\/([^/]+)\/update$/);
      if (req.method === 'POST' && productUpdateMatch) {
        const body = await parseForm(req);
        store.updateProduct(tenant.id, productUpdateMatch[1], {
          name: body.get('name'),
          price: body.get('price'),
          description: body.get('description')
        });
        return redirect(res, '/products');
      }

      const productDeleteMatch = requestUrl.pathname.match(/^\/products\/([^/]+)\/delete$/);
      if (req.method === 'POST' && productDeleteMatch) {
        store.deleteProduct(tenant.id, productDeleteMatch[1]);
        return redirect(res, '/products');
      }

      if (req.method === 'GET' && requestUrl.pathname === '/transactions/new') {
        const products = store.listProducts(tenant.id);
        return html(res, 'New Sale', `
          ${tenantHeader(tenant, user)}
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
        const transaction = store.createTransaction(tenant.id, user.id, {
          customerEmail: body.get('customerEmail'),
          items
        });
        session.lastEmailResult = await mailer({ transaction, tenant });
        return redirect(res, `/receipts/${transaction.id}`);
      }

      if (req.method === 'GET' && requestUrl.pathname === '/transactions') {
        return html(res, 'Transactions', `${tenantHeader(tenant, user)}<section class="card"><h2>Transactions</h2>${transactionTable(store.listTransactions(tenant.id))}</section>`);
      }

      if (req.method === 'GET' && requestUrl.pathname.startsWith('/receipts/')) {
        const transactionId = requestUrl.pathname.split('/').pop();
        const transaction = store.getTransaction(tenant.id, transactionId);
        if (!transaction) return send(res, 404, 'Receipt not found for this tenant.');
        const emailMessage = session.lastEmailResult
          ? `<p class="notice">Email status: ${escapeHtml(JSON.stringify(session.lastEmailResult))}</p>`
          : '';
        delete session.lastEmailResult;
        return html(res, 'Receipt', `${tenantHeader(tenant, user)}<section class="card receipt">${emailMessage}${renderReceiptHtml(transaction, tenant)}</section>`);
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
      return html(res, 'Error', `<section class="card"><h1>Unable to complete request</h1><p>${escapeHtml(error.message)}</p><p><a href="javascript:history.back()">Go back</a></p></section>`, 400);
    }
  };
}

function authPage(store) {
  const demoUsers = store.data.users.slice(0, 3);
  return `
    <section class="card hero">
      <h1>SaaS Web-Based Point-of-Sale</h1>
      <p>Login or register a new tenant/store. Each user is attached to exactly one tenant and only sees that tenant's data.</p>
    </section>
    <section class="grid two">
      <form class="card" method="post" action="/login">
        <h2>Login</h2>
        <label>Email <input required name="email" type="email" placeholder="coffee@example.com"></label>
        <label>Password <input required name="password" type="password" placeholder="password123"></label>
        <button type="submit">Login</button>
      </form>
      <form class="card" method="post" action="/register">
        <h2>Register New Tenant</h2>
        <label>Store / tenant name <input required name="tenantName" placeholder="My Shop"></label>
        <label>Your name <input required name="name" placeholder="Owner name"></label>
        <label>Email <input required name="email" type="email" placeholder="owner@example.com"></label>
        <label>Password <input required name="password" type="password" minlength="6" placeholder="At least 6 characters"></label>
        <button type="submit">Create tenant account</button>
      </form>
    </section>
    <section class="card">
      <h2>Demo accounts</h2>
      <p>Use these seeded users to demonstrate that different tenants see different data. Password: <code>password123</code>.</p>
      <div class="grid">
        ${demoUsers.map((user) => {
          const tenant = store.getTenant(user.tenantId);
          return `<article class="demo-account"><strong>${escapeHtml(user.email)}</strong><span>${escapeHtml(user.name)} · ${escapeHtml(tenant?.name || user.tenantId)}</span></article>`;
        }).join('')}
      </div>
    </section>`;
}

function getSession(req, res, sessions) {
  let sessionId = getSessionId(req);
  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = randomUUID();
    sessions.set(sessionId, {});
    res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`);
  }
  return sessions.get(sessionId);
}

function getSessionId(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((cookie) => {
    const [key, ...value] = cookie.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
  return cookies.sid;
}

function requiresTenant(pathname) {
  return ['/dashboard', '/products', '/transactions', '/receipts', '/api'].some((prefix) => pathname.startsWith(prefix));
}

async function parseForm(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return new URLSearchParams(data);
}

function tenantHeader(tenant, user) {
  return `<section class="card tenant"><h1>${escapeHtml(tenant.name)}</h1><p>Tenant ID: <code>${escapeHtml(tenant.id)}</code>. Logged in as ${escapeHtml(user.name)} (${escapeHtml(user.email)}). All products and transactions below are filtered by this tenant.</p></section>`;
}

function productManagementTable(products) {
  if (products.length === 0) return '<p>No products yet.</p>';
  return `<div class="table-scroll"><table><thead><tr><th>Name</th><th>Description</th><th>Price</th><th>Actions</th></tr></thead><tbody>${products.map((product) => `
    <tr>
      <td colspan="4">
        <form class="product-edit" method="post" action="/products/${escapeHtml(product.id)}/update">
          <input required name="name" value="${escapeHtml(product.name)}" aria-label="Product name">
          <input name="description" value="${escapeHtml(product.description)}" aria-label="Description">
          <input required name="price" type="number" min="0.01" step="0.01" value="${product.price}" aria-label="Price">
          <button type="submit">Update</button>
        </form>
        <form class="inline-form" method="post" action="/products/${escapeHtml(product.id)}/delete">
          <button class="danger" type="submit">Delete</button>
        </form>
      </td>
    </tr>`).join('')}</tbody></table></div>`;
}

function transactionTable(transactions) {
  if (transactions.length === 0) return '<p>No transactions yet.</p>';
  return `<table><thead><tr><th>ID</th><th>Date</th><th>Items</th><th>Total</th><th>Receipt</th></tr></thead><tbody>${transactions.map((transaction) => `<tr><td>${escapeHtml(transaction.id)}</td><td>${formatDate(transaction.createdAt)}</td><td>${transaction.items.length}</td><td>${formatCurrency(transaction.total)}</td><td><a href="/receipts/${escapeHtml(transaction.id)}">View</a></td></tr>`).join('')}</tbody></table>`;
}

function nav() {
  return `<nav><a href="/">Home</a><a href="/dashboard">Dashboard</a><a href="/products">Products</a><a href="/transactions/new">New Sale</a><a href="/transactions">Transactions</a><a href="/logout">Logout</a></nav>`;
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

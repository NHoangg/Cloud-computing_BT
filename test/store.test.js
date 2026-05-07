const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/data/store');
const { createApp } = require('../src/server');

test('products and transactions are isolated by tenant ID', () => {
  const store = makeStore();

  const coffeeProducts = store.listProducts('tenant-coffee');
  const bookProducts = store.listProducts('tenant-bookstore');

  assert.ok(coffeeProducts.every((product) => product.tenantId === 'tenant-coffee'));
  assert.ok(bookProducts.every((product) => product.tenantId === 'tenant-bookstore'));
  assert.equal(coffeeProducts.some((product) => product.name === 'Notebook'), false);

  const transaction = store.createTransaction('tenant-coffee', 'user-coffee-admin', {
    customerEmail: 'customer@example.com',
    items: [{ productId: 'prod-espresso', quantity: 2 }]
  });

  assert.equal(transaction.tenantId, 'tenant-coffee');
  assert.equal(transaction.subtotal, 5);
  assert.equal(store.listTransactions('tenant-bookstore').length, 0);
  assert.equal(store.getTransaction('tenant-bookstore', transaction.id), undefined);
});

test('web flow creates a tenant-scoped receipt and calls mailer', async () => {
  const store = makeStore();
  const sent = [];
  const server = http.createServer(createApp({
    store,
    mailer: async (payload) => {
      sent.push(payload);
      return { sent: true, provider: 'test' };
    }
  }));
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const switchResponse = await fetch(`${baseUrl}/switch-tenant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tenantId: 'tenant-coffee' }),
      redirect: 'manual'
    });
    assert.equal(switchResponse.status, 302);
    const cookie = switchResponse.headers.get('set-cookie').split(';')[0];

    const saleBody = new URLSearchParams();
    saleBody.append('customerEmail', 'buyer@example.com');
    saleBody.append('productId', 'prod-espresso');
    saleBody.append('quantity', '1');
    saleBody.append('productId', 'prod-latte');
    saleBody.append('quantity', '2');

    const transactionResponse = await fetch(`${baseUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: saleBody,
      redirect: 'manual'
    });

    assert.equal(transactionResponse.status, 302);
    assert.match(transactionResponse.headers.get('location'), /^\/receipts\/txn-/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].tenant.id, 'tenant-coffee');
    assert.equal(sent[0].transaction.total, 11);

    const receiptResponse = await fetch(`${baseUrl}${transactionResponse.headers.get('location')}`, {
      headers: { Cookie: cookie }
    });
    const receipt = await receiptResponse.text();
    assert.equal(receiptResponse.status, 200);
    assert.match(receipt, /Cloud Coffee Shop Receipt/);
    assert.doesNotMatch(receipt, /Notebook/);
  } finally {
    await close(server);
  }
});

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-store-'));
  return new JsonStore(path.join(dir, 'data.json'));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, resolve));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/data/store');
const { createApp } = require('../src/server');

test('authentication registers users under a tenant and keeps tenant data isolated', () => {
  const store = makeStore();
  const { tenant, user } = store.registerTenantWithUser({
    tenantName: 'Green Grocery',
    name: 'Grocery Owner',
    email: 'owner@grocery.test',
    password: 'secret123'
  });

  assert.equal(user.tenantId, tenant.id);
  assert.equal(store.authenticate('owner@grocery.test', 'secret123').id, user.id);
  assert.equal(store.authenticate('owner@grocery.test', 'wrong'), null);

  const groceryProduct = store.createProduct(tenant.id, { name: 'Apple', price: 0.5, description: 'Fruit' });
  assert.equal(groceryProduct.tenantId, tenant.id);
  assert.equal(store.listProducts('tenant-coffee').some((product) => product.name === 'Apple'), false);
});

test('product CRUD and transactions are isolated by tenant ID', () => {
  const store = makeStore();

  const coffeeProducts = store.listProducts('tenant-coffee');
  const bookProducts = store.listProducts('tenant-bookstore');

  assert.ok(coffeeProducts.every((product) => product.tenantId === 'tenant-coffee'));
  assert.ok(bookProducts.every((product) => product.tenantId === 'tenant-bookstore'));
  assert.equal(coffeeProducts.some((product) => product.name === 'Notebook'), false);

  const product = store.createProduct('tenant-coffee', { name: 'Mocha', price: 4.75, description: 'Chocolate coffee' });
  store.updateProduct('tenant-coffee', product.id, { name: 'Iced Mocha', price: 5.25, description: 'Cold drink' });
  assert.equal(store.getProduct('tenant-coffee', product.id).name, 'Iced Mocha');
  assert.equal(store.getProduct('tenant-bookstore', product.id), undefined);
  assert.equal(store.deleteProduct('tenant-bookstore', product.id), false);
  assert.equal(store.deleteProduct('tenant-coffee', product.id), true);

  const transaction = store.createTransaction('tenant-coffee', 'user-coffee-admin', {
    customerEmail: 'customer@example.com',
    items: [{ productId: 'prod-espresso', quantity: 2 }]
  });

  assert.equal(transaction.tenantId, 'tenant-coffee');
  assert.equal(transaction.subtotal, 5);
  assert.equal(store.listTransactions('tenant-bookstore').length, 0);
  assert.equal(store.getTransaction('tenant-bookstore', transaction.id), undefined);
});

test('web flow logs in, manages products, creates a tenant-scoped receipt, and calls mailer', async () => {
  const store = makeStore();
  const sent = [];
  const uploadedImages = [];
  const server = http.createServer(createApp({
    store,
    mailer: async (payload) => {
      sent.push(payload);
      return { sent: true, provider: 'test' };
    },
    imageUploader: async (file) => {
      uploadedImages.push(file);
      return `https://cdn.example.test/${file.filename}`;
    }
  }));
  await listen(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const loginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'coffee@example.com', password: 'password123' }),
      redirect: 'manual'
    });
    assert.equal(loginResponse.status, 302);
    const cookie = loginResponse.headers.get('set-cookie').split(';')[0];

    const productMultipart = multipartBody({
      fields: { name: 'Cappuccino', price: '4.50', description: 'Foam coffee' },
      file: { fieldName: 'image', filename: 'cappuccino.png', mimeType: 'image/png', content: Buffer.from('fake-png') }
    });
    await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': productMultipart.contentType, Cookie: cookie },
      body: productMultipart.body,
      redirect: 'manual'
    });
    const createdProduct = store.listProducts('tenant-coffee').find((product) => product.name === 'Cappuccino');
    assert.ok(createdProduct);
    assert.equal(createdProduct.imageUrl, 'https://cdn.example.test/cappuccino.png');
    assert.equal(uploadedImages.length, 1);

    await fetch(`${baseUrl}/products/${createdProduct.id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ name: 'Large Cappuccino', price: '5.00', description: 'Large foam coffee' }),
      redirect: 'manual'
    });
    assert.equal(store.getProduct('tenant-coffee', createdProduct.id).price, 5);

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

function multipartBody({ fields, file }) {
  const boundary = `----pos-test-${Date.now()}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`));
  chunks.push(file.content);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

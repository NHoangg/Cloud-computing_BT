const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_DATA = {
  tenants: [
    { id: 'tenant-coffee', name: 'Cloud Coffee Shop' },
    { id: 'tenant-bookstore', name: 'Blue Bookstore' }
  ],
  users: [
    { id: 'user-coffee-admin', tenantId: 'tenant-coffee', name: 'Coffee Admin', email: 'coffee@example.com' },
    { id: 'user-coffee-staff', tenantId: 'tenant-coffee', name: 'Coffee Staff', email: 'staff.coffee@example.com' },
    { id: 'user-book-admin', tenantId: 'tenant-bookstore', name: 'Bookstore Admin', email: 'books@example.com' }
  ],
  products: [
    { id: 'prod-espresso', tenantId: 'tenant-coffee', name: 'Espresso', price: 2.5, description: 'Single shot coffee' },
    { id: 'prod-latte', tenantId: 'tenant-coffee', name: 'Latte', price: 4.25, description: 'Milk coffee' },
    { id: 'prod-notebook', tenantId: 'tenant-bookstore', name: 'Notebook', price: 3.75, description: 'A5 ruled notebook' },
    { id: 'prod-pen', tenantId: 'tenant-bookstore', name: 'Gel Pen', price: 1.25, description: 'Blue ink pen' }
  ],
  transactions: []
};

class JsonStore {
  constructor(filePath = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'pos-data.json')) {
    this.filePath = filePath;
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.persist(DEFAULT_DATA);
      return structuredClone(DEFAULT_DATA);
    }
    const fileContents = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!fileContents) {
      this.persist(DEFAULT_DATA);
      return structuredClone(DEFAULT_DATA);
    }
    return JSON.parse(fileContents);
  }

  persist(data = this.data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  listTenants() {
    return this.data.tenants;
  }

  getTenant(tenantId) {
    return this.data.tenants.find((tenant) => tenant.id === tenantId);
  }

  listUsersByTenant(tenantId) {
    return this.data.users.filter((user) => user.tenantId === tenantId);
  }

  getUser(userId, tenantId) {
    return this.data.users.find((user) => user.id === userId && user.tenantId === tenantId);
  }

  listProducts(tenantId) {
    return this.data.products.filter((product) => product.tenantId === tenantId);
  }

  createProduct(tenantId, productInput) {
    const product = {
      id: `prod-${randomUUID().slice(0, 8)}`,
      tenantId,
      name: productInput.name.trim(),
      price: Number(productInput.price),
      description: (productInput.description || '').trim()
    };
    this.data.products.push(product);
    this.persist();
    return product;
  }

  createTransaction(tenantId, userId, transactionInput) {
    const products = this.listProducts(tenantId);
    const selectedItems = transactionInput.items
      .map((item) => {
        const product = products.find((candidate) => candidate.id === item.productId);
        const quantity = Number(item.quantity);
        if (!product || !Number.isInteger(quantity) || quantity <= 0) {
          return null;
        }
        return {
          productId: product.id,
          name: product.name,
          quantity,
          unitPrice: product.price,
          lineTotal: roundCurrency(quantity * product.price)
        };
      })
      .filter(Boolean);

    if (selectedItems.length === 0) {
      throw new Error('A transaction must contain at least one valid product and quantity.');
    }

    const subtotal = roundCurrency(selectedItems.reduce((sum, item) => sum + item.lineTotal, 0));
    const transaction = {
      id: `txn-${randomUUID().slice(0, 10)}`,
      tenantId,
      userId,
      customerEmail: (transactionInput.customerEmail || '').trim(),
      createdAt: new Date().toISOString(),
      items: selectedItems,
      subtotal,
      total: subtotal
    };

    this.data.transactions.push(transaction);
    this.persist();
    return transaction;
  }

  listTransactions(tenantId) {
    return this.data.transactions
      .filter((transaction) => transaction.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getTransaction(tenantId, transactionId) {
    return this.data.transactions.find(
      (transaction) => transaction.tenantId === tenantId && transaction.id === transactionId
    );
  }
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

module.exports = { JsonStore, DEFAULT_DATA, roundCurrency };

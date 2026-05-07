function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function renderReceiptHtml(transaction, tenant) {
  const rows = transaction.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.unitPrice)}</td>
          <td>${formatCurrency(item.lineTotal)}</td>
        </tr>`
    )
    .join('');

  return `
    <h1>${escapeHtml(tenant.name)} Receipt</h1>
    <p><strong>Transaction:</strong> ${escapeHtml(transaction.id)}</p>
    <p><strong>Date:</strong> ${formatDate(transaction.createdAt)}</p>
    <table border="1" cellpadding="8" cellspacing="0">
      <thead><tr><th>Item</th><th>Quantity</th><th>Price</th><th>Line Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><strong>Subtotal:</strong> ${formatCurrency(transaction.subtotal)}</p>
    <p><strong>Total:</strong> ${formatCurrency(transaction.total)}</p>`;
}

function renderReceiptText(transaction, tenant) {
  const lines = [
    `${tenant.name} Receipt`,
    `Transaction: ${transaction.id}`,
    `Date: ${formatDate(transaction.createdAt)}`,
    '',
    'Items:'
  ];

  transaction.items.forEach((item) => {
    lines.push(`${item.quantity} x ${item.name} @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`);
  });

  lines.push('', `Subtotal: ${formatCurrency(transaction.subtotal)}`, `Total: ${formatCurrency(transaction.total)}`);
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

module.exports = { formatCurrency, formatDate, renderReceiptHtml, renderReceiptText, escapeHtml };

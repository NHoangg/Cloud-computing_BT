const { renderReceiptHtml, renderReceiptText } = require('../receipt');

async function sendReceiptEmail({ transaction, tenant }) {
  if (!transaction.customerEmail) {
    return { skipped: true, reason: 'No customer email was provided.' };
  }

  const message = {
    to: transaction.customerEmail,
    from: process.env.EMAIL_FROM || 'receipts@example.com',
    subject: `Receipt ${transaction.id} from ${tenant.name}`,
    text: renderReceiptText(transaction, tenant),
    html: renderReceiptHtml(transaction, tenant)
  };

  if (process.env.SENDGRID_API_KEY) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: message.from },
        subject: message.subject,
        content: [
          { type: 'text/plain', value: message.text },
          { type: 'text/html', value: message.html }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`SendGrid failed with HTTP ${response.status}`);
    }
    return { sent: true, provider: 'sendgrid' };
  }

  console.info('Email provider is not configured. Receipt preview follows:\n%s', message.text);
  return { skipped: true, reason: 'Email provider is not configured.', preview: message.text };
}

module.exports = { sendReceiptEmail };

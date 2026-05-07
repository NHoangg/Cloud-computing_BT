const { createHash, createHmac, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function uploadProductImage(file) {
  if (!file || file.buffer.length === 0) return null;
  validateImage(file);

  if (!isS3Configured()) {
    return saveLocalImage(file);
  }

  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  const key = `product-images/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFileName(file.filename)}`;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${key}`;
  const bodyHash = sha256Hex(file.buffer);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const securityToken = process.env.AWS_SESSION_TOKEN;
  const tokenHeader = securityToken ? `x-amz-security-token:${securityToken}\n` : '';
  const canonicalHeaders = `content-type:${file.mimeType}\nhost:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n${tokenHeader}`;
  const signedHeaders = securityToken
    ? 'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    : 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', `/${key}`, '', canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = getSignatureKey(process.env.AWS_SECRET_ACCESS_KEY, dateStamp, region, 's3');
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    'Content-Type': file.mimeType,
    'X-Amz-Content-Sha256': bodyHash,
    'X-Amz-Date': amzDate
  };
  if (securityToken) headers['X-Amz-Security-Token'] = securityToken;

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: file.buffer
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`S3 image upload failed with HTTP ${response.status}: ${message.slice(0, 200)}`);
  }

  return publicImageUrl(bucket, region, key);
}

function validateImage(file) {
  if (!ALLOWED_IMAGE_TYPES.has(file.mimeType)) {
    throw new Error('Product image must be JPEG, PNG, WEBP, or GIF.');
  }
  if (file.buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Product image must be 5MB or smaller.');
  }
}

function isS3Configured() {
  return Boolean(
    process.env.AWS_REGION &&
      process.env.AWS_S3_BUCKET &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
  );
}

function saveLocalImage(file) {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const filename = `${randomUUID()}-${safeFileName(file.filename)}`;
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
  return `/uploads/${filename}`;
}

function publicImageUrl(bucket, region, key) {
  const baseUrl = process.env.AWS_S3_PUBLIC_BASE_URL;
  if (baseUrl) return `${baseUrl.replace(/\/$/, '')}/${key}`;
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function safeFileName(filename = 'product-image') {
  const cleaned = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'product-image';
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

module.exports = { uploadProductImage, isS3Configured, validateImage, MAX_IMAGE_BYTES, ALLOWED_IMAGE_TYPES };

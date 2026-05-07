# SaaS Web-Based Point-of-Sale (PoS)

This repository implements a cloud-ready SaaS PoS assessment application. It supports multiple independent tenants (shops/companies), product management, sales transactions, digital receipt generation, and receipt delivery by email.

## Features mapped to the assignment

- **Authentication + tenant accounts:** users can register a new tenant/store, log in, and log out; every user belongs to one tenant.
- **Multi-tenant support:** every product and transaction stores a `tenantId`; product, transaction, receipt, and API queries always filter by the authenticated user's active tenant.
- **Tenant users:** seed data includes multiple users under the same tenant to demonstrate a shop/company account with staff members.
- **Product management:** tenants can create, view, update, and delete products with name, price, description/category, and an optional image uploaded to AWS S3.
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
| `AWS_REGION` | AWS Region that contains the S3 bucket, for example `ap-southeast-1` | unset |
| `AWS_S3_BUCKET` | S3 bucket used for product images | unset |
| `AWS_ACCESS_KEY_ID` | IAM access key that can upload objects to the bucket | unset |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key for the uploader | unset |
| `AWS_SESSION_TOKEN` | Optional token when using temporary AWS credentials | unset |
| `AWS_S3_PUBLIC_BASE_URL` | Optional public base URL, such as a CloudFront distribution URL | S3 virtual-hosted URL |

## AWS S3 product image uploads

Product forms include an optional image field. When `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` are set, images are uploaded directly from the server to S3 using AWS Signature Version 4. If those variables are missing, images are saved to `public/uploads/` for local development only.

### AWS setup steps

1. Create an S3 bucket in your chosen Region, for example `ap-southeast-1`. Bucket names must be globally unique.
2. Create an IAM user or deployment role for this app. Prefer an IAM role on your cloud host when available; use IAM access keys only for student/demo deployment.
3. Attach a least-privilege IAM policy that allows image uploads to the bucket prefix used by the app:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/product-images/*"
    }
  ]
}
```

4. Decide how customers will view images:
   - **Simple demo option:** allow public read for objects under `product-images/*` with a bucket policy.
   - **Better production option:** keep the bucket private, put CloudFront in front of it, and set `AWS_S3_PUBLIC_BASE_URL` to the CloudFront domain.

Example public-read bucket policy for demo only:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadProductImages",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/product-images/*"
    }
  ]
}
```

If you use this public-read demo policy, S3 Block Public Access settings must not block the bucket policy. Do **not** allow public `s3:PutObject`; only the app's IAM user/role should upload.

5. Configure the app environment variables on your cloud host:

```bash
export AWS_REGION="ap-southeast-1"
export AWS_S3_BUCKET="YOUR_BUCKET_NAME"
export AWS_ACCESS_KEY_ID="YOUR_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="YOUR_SECRET_ACCESS_KEY"
# Optional if you use temporary credentials:
export AWS_SESSION_TOKEN="YOUR_SESSION_TOKEN"
# Optional if using CloudFront or a custom CDN URL:
export AWS_S3_PUBLIC_BASE_URL="https://YOUR_DISTRIBUTION.cloudfront.net"
```

6. Restart the app, log in, open **Products**, choose an image in the product form, and save. The product record stores the returned image URL in `imageUrl`.

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

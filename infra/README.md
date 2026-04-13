# Infrastructure

CDK stack that deploys the Stability Sim static site to AWS.

**Domain:** `stability-sim.systems` (must already exist as a Route53 hosted zone)

## Architecture

- **S3** — private bucket for static assets
- **CloudFront** — CDN with Origin Access Control, HTTPS redirect, SPA fallback (404 → index.html)
- **ACM** — DNS-validated TLS certificate (created in us-east-1 for CloudFront)
- **Route53** — A + AAAA alias records pointing to CloudFront

## Prerequisites

- AWS CLI configured with credentials that can manage the above resources
- Node.js
- The site must be built first (`npm run build` in the project root creates `dist/`)

## Deploy

```bash
# From the project root — build the site
npm run build

# From this directory — deploy
npm install
npx cdk bootstrap --profile <your-profile>   # first time only
npx cdk deploy --profile <your-profile>
```

First deploy takes ~5 minutes (certificate validation + CloudFront distribution creation). Subsequent deploys take ~2 minutes (S3 upload + CloudFront invalidation).

## Other commands

```bash
npx cdk diff --profile <your-profile>     # preview changes
npx cdk synth                              # emit CloudFormation template
npx cdk destroy --profile <your-profile>   # tear down everything
```

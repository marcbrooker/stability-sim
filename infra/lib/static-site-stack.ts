import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';

const DOMAIN_NAME = 'stability-sim.systems';

export class StaticSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Look up the existing Route53 hosted zone
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: DOMAIN_NAME,
    });

    // TLS certificate (DNS-validated, must be in us-east-1 for CloudFront)
    const certificate = new acm.Certificate(this, 'SiteCert', {
      domainName: DOMAIN_NAME,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // S3 bucket for static assets (private — CloudFront uses OAC)
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: [DOMAIN_NAME],
      certificate,
      defaultRootObject: 'index.html',
      // SPA fallback: serve index.html for 404s so client-side routing works
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // DNS records pointing to CloudFront
    new route53.ARecord(this, 'SiteARecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new route53.AaaaRecord(this, 'SiteAAAARecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    // Deploy hashed assets (JS, CSS) with long-lived cache headers
    const distPath = path.join(__dirname, '..', '..', 'dist');
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(distPath, { exclude: ['index.html', 'favicon.svg'] })],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/assets/*'],
      prune: false,
      cacheControl: [
        s3deploy.CacheControl.maxAge(cdk.Duration.days(365)),
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.immutable(),
      ],
    });

    // Deploy index.html with revalidation (so new deploys take effect immediately).
    // assetHash forces CDK to treat every deploy as new, ensuring index.html is
    // always uploaded even if CDK's content hash doesn't detect a change.
    new s3deploy.BucketDeployment(this, 'DeployHtml', {
      sources: [s3deploy.Source.asset(distPath, {
        exclude: ['assets/*', 'favicon.svg'],
        assetHash: `html-${Date.now()}`,
        assetHashType: cdk.AssetHashType.CUSTOM,
      })],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/index.html'],
      prune: false,
      cacheControl: [
        s3deploy.CacheControl.noCache(),
      ],
    });

    // Deploy favicon with 1-day cache
    new s3deploy.BucketDeployment(this, 'DeployFavicon', {
      sources: [s3deploy.Source.asset(distPath, {
        exclude: ['*', '!favicon.svg'],
      })],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/favicon.svg'],
      prune: false,
      cacheControl: [
        s3deploy.CacheControl.maxAge(cdk.Duration.days(1)),
        s3deploy.CacheControl.setPublic(),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${DOMAIN_NAME}` });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'BucketName', { value: siteBucket.bucketName });
  }
}

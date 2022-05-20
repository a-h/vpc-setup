import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class VpcSetupStack extends Stack {
        constructor(scope: Construct, id: string, props?: StackProps) {
                super(scope, id, props);

                // The default configuration for VPCs is sensible. So you don't really need to add any initial configuration at all.

                // You get 1 public, and 1 private subnet per availability zone in the region.

                // But I think it's a good idea to add in the "Isolated" configuration too, in case you want to
                // have any infrastructure that isn't allowed to connect to the Internet.

                // If you want to control costs, you can reduce the number of zones with the maxAzs config parameter.
                // I sometimes do this in non-prod envs.

                // CDK sets up NAT Gateways, and all of the network routing to enable private subnets to
                // access the Internet (e.g. to make outbound API calls).

                // Best practice here is that only load balancers should be in the public subnets. All of your
                // Lambda functions, Fargate instances etc., should be in the private subnet.

                // For personal stuff and playing around, I sometimes don't do this to keep costs as low as possible.
                // Here, I put instances in the public subnet, and set the natGateways field to zero. This means
                // there's no running cost for the network.

                // Anything that's only using VPC endpoints (more on that later, and shouldn't have Internet access)
                // goes into the ISOLATED subnet. I use this for data processing of large datasets where I want
                // to make sure that the data can't be easily leaked to the Internet by a malicious program.
                const vpc = new ec2.Vpc(this, "VPC", {
                        subnetConfiguration: [
                                {
                                        name: "public-subnet",
                                        subnetType: ec2.SubnetType.PUBLIC,
                                        cidrMask: 24,
                                },
                                {
                                        name: "private-subnet",
                                        subnetType: ec2.SubnetType.PRIVATE,
                                        cidrMask: 24,
                                },
                                {
                                        name: "public-subnet",
                                        subnetType: ec2.SubnetType.ISOLATED,
                                        cidrMask: 24,
                                },
                        ],
                });

                // It's best practice to log API Gateway access, CloudFront requests, VPC flow logs etc.
                // For all of these, you need a log bucket to put them in.

                // Best practice is to use the block public access feature of S3 to prevent accidental exposure of data.

                // It's also best practice to ensure that clients use TLS to transfer data, which is enforced by a role.
                // Before CDK, you have to write it yourself, but it's easy now.

                // If you don't version your bucket, it will show up in AWS Security Hub or similar.

                // And of course, encrypt everything. The default is not to use encryption. There's no cost for encryption though.
                const s3LogBucket = new s3.Bucket(this, "s3LogBucket", {
                        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                        enforceSSL: true,
                        versioned: true,
                        accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
                        encryption: s3.BucketEncryption.S3_MANAGED,
                        intelligentTieringConfigurations: [
                                {
                                        name: "archive",
                                        archiveAccessTierTime: Duration.days(90),
                                        deepArchiveAccessTierTime: Duration.days(180),
                                },
                        ],
                })

                // Add flow logs.

                // If your service is attacked, you can use flow logs to determine what outbound or inbound IP
                // addresses were used, and also determine the quantity of data extracted etc.

                // You might copy these outside of the account for a backup, since an attacker might
                // delete them.

                // VPC flow logs are also used by security tooling like AWS GuardDuty to look for unusual traffic
                // patterns. So you generally need it switched on.
                const vpcFlowLogRole = new iam.Role(this, "vpcFlowLogRole", {
                        assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
                })
                s3LogBucket.grantWrite(vpcFlowLogRole, "sharedVpcFlowLogs/*")

                // Create flow logs to S3.
                new ec2.FlowLog(this, "sharedVpcLowLogs", {
                        destination: ec2.FlowLogDestination.toS3(s3LogBucket, "sharedVpcFlowLogs/"),
                        trafficType: ec2.FlowLogTrafficType.ALL,
                        flowLogName: "sharedVpcFlowLogs",
                        resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
                })

                // Create VPC endpoints for common services.

                // This reduces the internet traffic (NAT Gateway costs), and improves security, since
                // your data is not mixing with public Internet traffic.

                // CDK sets up all of the routing for you, and the AWS SDK is aware of the 
                // requirement to use the endpoint automatically.
                vpc.addGatewayEndpoint("dynamoDBEndpoint", {
                        service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
                })
                vpc.addGatewayEndpoint("s3Endpoint", {
                        service: ec2.GatewayVpcEndpointAwsService.S3,
                })

                // Output the ID of the VPC.
                new CfnOutput(this, "sharedVpcId", {
                        exportName: "shared-vpc-id",
                        value: vpc.vpcId,
                })

                // Finally, there's some stuff that CDK (and AWS generally) gets wrong.

                // Any VPC you create will have default security groups added which allow egress.
                // These immediately show up on AWS's own security tooling (AWS Security Hub etc.)

                // CDK can't modify these, whereas Terraform has a special resource for it:

                // resource "aws_default_security_group" "default" {
                //  vpc_id = aws_vpc.controltowervpc.id
                //
                //  ingress {
                //    //none
                //  }
                //
                //  egress {
                //    //none
                //  }
                // }

                // So, I built a program to fix up VPCs automatically by removing these default rules.

                // https://github.com/a-h/default-security-group-tightener/blob/main/main.go
        }
}

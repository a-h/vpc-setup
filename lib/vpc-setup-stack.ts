import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class VpcSetupStack extends Stack {
        constructor(scope: Construct, id: string, props?: StackProps) {
                super(scope, id, props);

                // Define subnets.
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
                                        name: "isolated-subnet",
                                        subnetType: ec2.SubnetType.ISOLATED,
                                        cidrMask: 24,
                                },
                        ],
                });

                // Create log bucket.
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
                vpc.addGatewayEndpoint("dynamoDBEndpoint", {
                        service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
                })
                vpc.addGatewayEndpoint("s3Endpoint", {
                        service: ec2.GatewayVpcEndpointAwsService.S3,
                })

                // Create a shared security group.
                const noInboundAllOutboundSecurityGroup = new ec2.SecurityGroup(this, "noInboundAllOutboundSecurityGroup", {
                        vpc: vpc,
                        allowAllOutbound: true,
                        description: "No inbound / all outbound",
                        securityGroupName: "noInboundAllOutboundSecurityGroup",
                })
                new CfnOutput(this, "noInboundAllOutboundSecurityGroup", {
                        exportName: "noInboundAllOutboundSecurityGroup",
                        value: noInboundAllOutboundSecurityGroup.securityGroupId,
                })

                // Output the ID of the VPC.
                new CfnOutput(this, "sharedVpcId", {
                        exportName: "shared-vpc-id",
                        value: vpc.vpcId,
                })
        }
}

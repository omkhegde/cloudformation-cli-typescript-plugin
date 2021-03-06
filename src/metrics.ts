import CloudWatch, { Dimension, DimensionName } from 'aws-sdk/clients/cloudwatch';

import { SessionProxy } from './proxy';
import { Action, MetricTypes, StandardUnit } from './interface';
import { BaseHandlerException } from './exceptions';

const LOGGER = console;
const METRIC_NAMESPACE_ROOT = 'AWS/CloudFormation';

export type DimensionRecord = Record<DimensionName, string>;

export function formatDimensions(dimensions: DimensionRecord): Array<Dimension> {
    const formatted: Array<Dimension> = [];
    for (const key in dimensions) {
        const value = dimensions[key];
        const dimension: Dimension = {
            Name: key,
            Value: value,
        };
        formatted.push(dimension);
    }
    return formatted;
}

/**
 * A cloudwatch based metric publisher.
 * Given a resource type and session,
 * this publisher will publish metrics to CloudWatch.
 * Can be used with the MetricsPublisherProxy.
 */
export class MetricsPublisher {
    private namespace: string;
    private client: CloudWatch;

    constructor(session: SessionProxy, private resourceType: string) {
        this.client = session.client('CloudWatch') as CloudWatch;
        this.namespace = MetricsPublisher.makeNamespace(resourceType);
    }

    async publishMetric(
        metricName: MetricTypes,
        dimensions: DimensionRecord,
        unit: StandardUnit,
        value: number,
        timestamp: Date
    ): Promise<void> {
        try {
            const metric = await this.client
                .putMetricData({
                    Namespace: this.namespace,
                    MetricData: [
                        {
                            MetricName: metricName,
                            Dimensions: formatDimensions(dimensions),
                            Unit: unit,
                            Timestamp: timestamp,
                            Value: value,
                        },
                    ],
                })
                .promise();
            LOGGER.debug('Response from "putMetricData"', metric);
        } catch (err) {
            LOGGER.error(`An error occurred while publishing metrics: ${err.message}`);
        }
    }

    /**
     * Publishes an exception based metric
     */
    async publishExceptionMetric(
        timestamp: Date,
        action: Action,
        error: Error
    ): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyExceptionType:
                (error as BaseHandlerException).errorCode || error.constructor.name,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerException,
            dimensions,
            StandardUnit.Count,
            1.0,
            timestamp
        );
    }

    /**
     * Publishes a metric related to invocations
     */
    async publishInvocationMetric(timestamp: Date, action: Action): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerInvocationCount,
            dimensions,
            StandardUnit.Count,
            1.0,
            timestamp
        );
    }

    /**
     * Publishes an duration metric
     */
    async publishDurationMetric(
        timestamp: Date,
        action: Action,
        milliseconds: number
    ): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerInvocationDuration,
            dimensions,
            StandardUnit.Milliseconds,
            milliseconds,
            timestamp
        );
    }

    /**
     * Publishes an log delivery exception metric
     */
    async publishLogDeliveryExceptionMetric(
        timestamp: Date,
        error: Error
    ): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: 'ProviderLogDelivery',
            DimensionKeyExceptionType:
                (error as BaseHandlerException).errorCode || error.constructor.name,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerException,
            dimensions,
            StandardUnit.Count,
            1.0,
            timestamp
        );
    }

    static makeNamespace(resourceType: string): string {
        const suffix = resourceType.replace(/::/g, '/');
        return `${METRIC_NAMESPACE_ROOT}/${suffix}`;
    }
}

/**
 * A proxy for publishing metrics to multiple publishers.
 * Iterates over available publishers and publishes.
 */
export class MetricsPublisherProxy {
    private publishers: Array<MetricsPublisher>;

    constructor() {
        this.publishers = [];
    }

    /**
     * Adds a metrics publisher to the list of publishers
     */
    addMetricsPublisher(session?: SessionProxy, typeName?: string): void {
        if (session && typeName) {
            this.publishers.push(new MetricsPublisher(session, typeName));
        }
    }

    /**
     * Publishes an exception based metric to the list of publishers
     */
    async publishExceptionMetric(
        timestamp: Date,
        action: Action,
        error: Error
    ): Promise<any> {
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricsPublisher) => {
                return publisher.publishExceptionMetric(timestamp, action, error);
            }
        );
        return await Promise.all(promises);
    }

    /**
     * Publishes a metric related to invocations to the list of publishers
     */
    async publishInvocationMetric(timestamp: Date, action: Action): Promise<any> {
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricsPublisher) => {
                return publisher.publishInvocationMetric(timestamp, action);
            }
        );
        return await Promise.all(promises);
    }

    /**
     * Publishes a duration metric to the list of publishers
     */
    async publishDurationMetric(
        timestamp: Date,
        action: Action,
        milliseconds: number
    ): Promise<any> {
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricsPublisher) => {
                return publisher.publishDurationMetric(timestamp, action, milliseconds);
            }
        );
        return await Promise.all(promises);
    }

    /**
     * Publishes a log delivery exception metric to the list of publishers
     */
    async publishLogDeliveryExceptionMetric(
        timestamp: Date,
        error: Error
    ): Promise<any> {
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricsPublisher) => {
                return publisher.publishLogDeliveryExceptionMetric(timestamp, error);
            }
        );
        return await Promise.all(promises);
    }
}

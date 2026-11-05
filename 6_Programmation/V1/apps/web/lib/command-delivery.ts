import type { MqttPublisher } from "@spp/infrastructure";

export type DeliveryResult = "confirmed" | "failed" | "uncertain";

interface DeliverCommandOptions {
  publisher: MqttPublisher;
  topic: string;
  payload: string;
  retain: boolean;
  onDefiniteFailure: (message: string) => Promise<void>;
  onUncertain: (message: string) => Promise<void>;
  onPublished: () => Promise<void>;
}

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export const deliverCommand = async (options: DeliverCommandOptions): Promise<DeliveryResult> => {
  try {
    await options.publisher.connect();
  } catch (error) {
    await options.onDefiniteFailure(errorMessage(error, "Unable to connect to MQTT"));
    await options.publisher.close().catch(() => undefined);
    return "failed";
  }

  try {
    await options.publisher.publish(options.topic, options.payload, { qos: 1, retain: options.retain });
  } catch (error) {
    await options.onUncertain(errorMessage(error, "MQTT acknowledgement was not received")).catch(() => undefined);
    return "uncertain";
  } finally {
    await options.publisher.close().catch(() => undefined);
  }

  try {
    await options.onPublished();
  } catch (error) {
    await options.onUncertain(errorMessage(error, "The published command could not be recorded")).catch(() => undefined);
    return "uncertain";
  }
  return "confirmed";
};

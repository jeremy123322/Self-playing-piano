import { connectAsync, type MqttClient } from "mqtt";

export interface PublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export interface MqttPublisher {
  connect(): Promise<void>;
  publish(topic: string, payload: string, options?: PublishOptions): Promise<void>;
  close(): Promise<void>;
}

export class StandardMqttPublisher implements MqttPublisher {
  private client: MqttClient | undefined;

  constructor(
    private readonly url: string,
    private readonly username?: string,
    private readonly password?: string,
  ) {}

  async connect() {
    if (this.client?.connected) return;
    this.client = await connectAsync(this.url, {
      ...(this.username ? { username: this.username } : {}),
      ...(this.password ? { password: this.password } : {}),
      clean: true,
      connectTimeout: 5_000,
      reconnectPeriod: 0,
    });
  }

  async publish(topic: string, payload: string, options: PublishOptions = {}) {
    if (!this.client?.connected) throw new Error("MQTT publisher is not connected");
    await this.client.publishAsync(topic, payload, { qos: options.qos ?? 1, retain: options.retain ?? true });
  }

  async close() {
    if (!this.client) return;
    await this.client.endAsync();
    this.client = undefined;
  }
}

export const createMqttPublisher = (environment: NodeJS.ProcessEnv = process.env): MqttPublisher => {
  if (!environment.MQTT_URL) throw new Error("MQTT_URL is required");
  return new StandardMqttPublisher(environment.MQTT_URL, environment.MQTT_SERVER_USERNAME, environment.MQTT_SERVER_PASSWORD);
};

export const desiredTopic = (pianoId: string, prefix = process.env.MQTT_TOPIC_PREFIX ?? "pianos") => `${prefix}/${pianoId}/v1/desired`;
export const reportedTopic = (pianoId: string, prefix = process.env.MQTT_TOPIC_PREFIX ?? "pianos") => `${prefix}/${pianoId}/v1/reported`;

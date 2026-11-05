import { createDatabase } from "@spp/database";
import { createMqttPublisher, createObjectStorage } from "@spp/infrastructure";

const globalServices = globalThis as typeof globalThis & {
  pianoDatabase?: ReturnType<typeof createDatabase>;
  pianoStorage?: ReturnType<typeof createObjectStorage>;
};

export const database = () => {
  globalServices.pianoDatabase ??= createDatabase();
  return globalServices.pianoDatabase;
};

export const storage = () => {
  globalServices.pianoStorage ??= createObjectStorage();
  return globalServices.pianoStorage;
};

export const mqttPublisher = () => createMqttPublisher();

import { describe, expect, it, vi } from "vitest";
import type { MqttPublisher } from "@spp/infrastructure";
import { deliverCommand } from "./command-delivery";

const publisher = (overrides: Partial<MqttPublisher> = {}): MqttPublisher => ({
  connect: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const callbacks = () => ({
  onDefiniteFailure: vi.fn().mockResolvedValue(undefined),
  onUncertain: vi.fn().mockResolvedValue(undefined),
  onPublished: vi.fn().mockResolvedValue(undefined),
});

const deliver = (target: MqttPublisher, handlers = callbacks(), retain = false) =>
  deliverCommand({ publisher: target, topic: "desired", payload: "{}", retain, ...handlers });

describe("deliverCommand", () => {
  it("treats connection failure as definitely not published", async () => {
    const target = publisher({ connect: vi.fn().mockRejectedValue(new Error("offline")) });
    const handlers = callbacks();
    expect(await deliver(target, handlers)).toBe("failed");
    expect(handlers.onDefiniteFailure).toHaveBeenCalledWith("offline");
    expect(target.publish).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous publish locked", async () => {
    const target = publisher({ publish: vi.fn().mockRejectedValue(new Error("puback timeout")) });
    const handlers = callbacks();
    expect(await deliver(target, handlers)).toBe("uncertain");
    expect(handlers.onUncertain).toHaveBeenCalledWith("puback timeout");
    expect(handlers.onDefiniteFailure).not.toHaveBeenCalled();
  });

  it("treats failed audit metadata as uncertain because sequencing depends on it", async () => {
    const handlers = callbacks();
    handlers.onPublished.mockRejectedValue(new Error("database unavailable"));
    expect(await deliver(publisher(), handlers)).toBe("uncertain");
    expect(handlers.onDefiniteFailure).not.toHaveBeenCalled();
    expect(handlers.onUncertain).toHaveBeenCalledWith("database unavailable");
  });

  it("passes through the command-specific retained flag", async () => {
    const target = publisher();
    expect(await deliver(target, callbacks(), true)).toBe("confirmed");
    expect(target.publish).toHaveBeenCalledWith("desired", "{}", { qos: 1, retain: true });
  });
});

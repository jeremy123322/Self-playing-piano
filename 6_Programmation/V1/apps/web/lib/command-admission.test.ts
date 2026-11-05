import { describe, expect, it } from "vitest";
import { commandCanBeAdmitted, commandShouldBeRetained } from "./command-admission";

describe("command admission", () => {
  it("blocks a later publish while the previous request is still publishing", () => {
    expect(commandCanBeAdmitted("pending", "stop")).toBe(false);
    expect(commandCanBeAdmitted("pending", "pause")).toBe(false);
  });

  it("waits for device acknowledgement except for safety shutdowns", () => {
    expect(commandCanBeAdmitted("published", "pause")).toBe(false);
    expect(commandCanBeAdmitted("dispatch_uncertain", "resume")).toBe(false);
    expect(commandCanBeAdmitted("published", "stop")).toBe(true);
    expect(commandCanBeAdmitted("dispatch_uncertain", "emergency_recover")).toBe(true);
    expect(commandCanBeAdmitted("acknowledged", "pause")).toBe(true);
  });

  it("retains only shutdown commands that are safe after reconnect", () => {
    expect(commandShouldBeRetained("play")).toBe(false);
    expect(commandShouldBeRetained("pause")).toBe(false);
    expect(commandShouldBeRetained("stop")).toBe(true);
    expect(commandShouldBeRetained("emergency_recover")).toBe(true);
    expect(commandShouldBeRetained("restart_controller")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { commandRequiresActiveSession, isAdminCommand } from "./command-policy";

describe("command policy", () => {
  it.each(["emergency_recover", "restart_controller", "enter_provisioning"] as const)(
    "keeps %s admin-only and independent of the active session",
    (type) => {
      expect(isAdminCommand(type)).toBe(true);
      expect(commandRequiresActiveSession(type)).toBe(false);
    },
  );

  it.each(["pause", "resume", "restart", "stop"] as const)(
    "requires the current session for %s",
    (type) => expect(commandRequiresActiveSession(type)).toBe(true),
  );
});

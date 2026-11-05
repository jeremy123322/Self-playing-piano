import { describe, expect, it } from "vitest";
import { completedPosition, guardCommand } from "./command-guard";

describe("simulator command guard", () => {
  it("does not replay a retained revision after restart", () => {
    expect(guardCommand(7, 7, 4_070_908_800)).toBe("duplicate");
  });

  it("rejects expired and malformed epoch values", () => {
    expect(guardCommand(7, 8, 99, 100)).toBe("expired");
    expect(guardCommand(7, 8, Number.NaN, 100)).toBe("expired");
    expect(guardCommand(7, 8, 101, 100)).toBe("new");
  });

  it("reports the duration at natural completion", () => {
    expect(completedPosition(12_345)).toBe(12_345);
  });
});

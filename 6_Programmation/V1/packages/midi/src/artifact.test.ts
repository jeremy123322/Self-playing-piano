import { describe, expect, it } from "vitest";
import { decodeArtifact, encodeArtifact } from "./artifact.js";

describe("artifact codec", () => {
  it("round-trips the firmware format", () => {
    const encoded = encodeArtifact({
      version: 2,
      profileVersion: 2,
      durationMs: 500,
      notes: [{ startMs: 100, durationMs: 400, keyIndex: 40, velocity: 200, flags: 0, activationLeadMs: 20 }],
    });
    expect(encoded.byteLength).toBe(28);
    expect(decodeArtifact(encoded)).toEqual({
      version: 2,
      profileVersion: 2,
      durationMs: 500,
      notes: [{ startMs: 100, durationMs: 400, keyIndex: 40, velocity: 200, flags: 0, activationLeadMs: 20 }],
    });
  });

  it("rejects a truncated artifact", () => {
    const malformed = new Uint8Array(16);
    malformed.set(new TextEncoder().encode("SPP1"));
    malformed[4] = 2;
    malformed[5] = 2;
    malformed[6] = 12;
    malformed[8] = 1;
    expect(() => decodeArtifact(malformed)).toThrow("record count");
  });

  it("decodes the explicit legacy v1/profile v1 compatibility case", () => {
    const encoded = encodeArtifact({
      version: 2,
      profileVersion: 2,
      durationMs: 500,
      notes: [{ startMs: 100, durationMs: 400, keyIndex: 40, velocity: 200, flags: 0, activationLeadMs: 20 }],
    });
    encoded[4] = 1;
    encoded[5] = 1;
    encoded[27] = 0;
    expect(decodeArtifact(encoded)).toMatchObject({
      version: 1,
      profileVersion: 1,
      notes: [{ activationLeadMs: 0 }],
    });
  });

  it("rejects an artifact without a valid profile version", () => {
    expect(() => encodeArtifact({
      version: 2,
      profileVersion: 0,
      durationMs: 500,
      notes: [{ startMs: 100, durationMs: 400, keyIndex: 40, velocity: 200, flags: 0, activationLeadMs: 20 }],
    })).toThrow("Invalid profile version");
  });
});

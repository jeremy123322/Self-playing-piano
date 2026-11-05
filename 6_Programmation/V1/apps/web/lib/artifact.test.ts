import { describe, expect, it } from "vitest";
import { decodeArtifactNotes } from "./artifact";

const artifact = (version: number, activationLeadMs: number) => {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("SPP1"));
  view.setUint8(4, version);
  view.setUint16(6, 12, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, 5_100, true);
  view.setUint32(16, 5_000, true);
  view.setUint32(20, 100, true);
  view.setUint8(24, 39);
  view.setUint8(25, 127);
  view.setUint8(27, activationLeadMs);
  return bytes.buffer;
};

describe("decodeArtifactNotes", () => {
  it("keeps musical strike timing and exposes v2 actuator lead separately", () => {
    expect(decodeArtifactNotes(artifact(2, 20))).toEqual([{
      startMs: 5_000,
      durationMs: 100,
      keyIndex: 39,
      velocity: 127,
      flags: 0,
      activationLeadMs: 20,
    }]);
  });

  it("supports v1 artifacts during library migration", () => {
    expect(decodeArtifactNotes(artifact(1, 0))[0]?.activationLeadMs).toBe(0);
  });

  it("rejects unknown artifact versions", () => {
    expect(decodeArtifactNotes(artifact(3, 20))).toEqual([]);
  });
});

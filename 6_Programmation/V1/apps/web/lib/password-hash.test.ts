import { hash } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";
import { verifyEncodedHash } from "./password-hash";

describe("verifyEncodedHash", () => {
  it("round-trips a base64 Argon2 hash without dotenv-sensitive characters", async () => {
    const encoded = Buffer.from(await hash("shared secret"), "utf8").toString("base64");
    expect(encoded).not.toContain("$");
    await expect(verifyEncodedHash(encoded, "shared secret")).resolves.toBe(true);
    await expect(verifyEncodedHash(encoded, "wrong")).resolves.toBe(false);
  });
});

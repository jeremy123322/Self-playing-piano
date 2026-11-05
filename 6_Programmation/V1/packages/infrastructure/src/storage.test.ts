import { describe, expect, it } from "vitest";
import { MemoryObjectStorage } from "./storage.js";

describe("MemoryObjectStorage", () => {
  it("implements the storage contract", async () => {
    const storage = new MemoryObjectStorage();
    await storage.put("songs/example.mid", new Uint8Array([1, 2, 3]), "audio/midi");
    await expect(storage.head("songs/example.mid")).resolves.toMatchObject({ byteSize: 3 });
    await expect(storage.getDownloadUrl("songs/example.mid")).resolves.toContain("songs%2Fexample.mid");
    await storage.delete("songs/example.mid");
    await expect(storage.head("songs/example.mid")).resolves.toBeNull();
  });
});

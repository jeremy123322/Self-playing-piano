import { describe, expect, it, vi } from "vitest";
import { reprocessAllSongs } from "./reprocess-all";

describe("reprocessAllSongs", () => {
  it("runs sequentially and reports progress", async () => {
    const active: string[] = [];
    let maximumConcurrent = 0;
    const progress = vi.fn();
    const songs = [
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
    ];

    const result = await reprocessAllSongs(songs, {
      reprocess: async (song) => {
        active.push(song.id);
        maximumConcurrent = Math.max(maximumConcurrent, active.length);
        await Promise.resolve();
        active.pop();
      },
      onProgress: progress,
    });

    expect(maximumConcurrent).toBe(1);
    expect(result).toEqual({ succeeded: 2, failures: [] });
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ processed: 2, total: 2 }));
  });

  it("continues after an individual song fails", async () => {
    const attempted: string[] = [];
    const songs = [
      { id: "one", title: "One" },
      { id: "two", title: "Two" },
      { id: "three", title: "Three" },
    ];

    const result = await reprocessAllSongs(songs, {
      reprocess: async (song) => {
        attempted.push(song.id);
        if (song.id === "two") throw new Error("Original unavailable");
      },
    });

    expect(attempted).toEqual(["one", "two", "three"]);
    expect(result).toEqual({
      succeeded: 2,
      failures: [{ title: "Two", message: "Original unavailable" }],
    });
  });
});

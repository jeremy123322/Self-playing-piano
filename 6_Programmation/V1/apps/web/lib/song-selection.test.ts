import { describe, expect, it } from "vitest";
import { visibleSelection } from "./song-selection";

describe("visibleSelection", () => {
  it("does not retain a song hidden by search", () => {
    expect(visibleSelection([{ id: "visible" }], "hidden")).toBe("visible");
  });

  it("clears selection when no songs are visible", () => {
    expect(visibleSelection([], "hidden")).toBeUndefined();
  });
});

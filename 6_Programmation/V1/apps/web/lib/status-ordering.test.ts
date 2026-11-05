import { describe, expect, it } from "vitest";
import { statusIsCurrentOrNewer } from "./status-ordering";

describe("reported status ordering", () => {
  const current = {
    lastHandledRevision: 4,
    lastAppliedRevision: 3,
    reportedAt: "2026-01-01T00:00:10Z",
  };

  it("orders by handled revision, applied revision, then device timestamp", () => {
    expect(statusIsCurrentOrNewer(current, { ...current, lastHandledRevision: 5, reportedAt: "2026-01-01T00:00:00Z" })).toBe(true);
    expect(statusIsCurrentOrNewer(current, { ...current, lastHandledRevision: 3, reportedAt: "2026-01-01T00:00:20Z" })).toBe(false);
    expect(statusIsCurrentOrNewer(current, { ...current, lastAppliedRevision: 2 })).toBe(false);
    expect(statusIsCurrentOrNewer(current, { ...current, reportedAt: "2026-01-01T00:00:09Z" })).toBe(false);
  });

  it("accepts an equal cursor for idempotent retries", () => {
    expect(statusIsCurrentOrNewer(current, current)).toBe(true);
  });
});

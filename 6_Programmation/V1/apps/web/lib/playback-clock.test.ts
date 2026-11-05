import { describe, expect, it } from "vitest";
import { playbackPositionAt, rebasePlaybackClock } from "./playback-clock";

const playing = (
  positionMs: number,
  sessionId = "session-1",
  lastAppliedRevision = 1,
  reportedAt = "2026-01-01T00:00:00.000Z",
) => ({
  state: "playing" as const,
  sessionId,
  positionMs,
  durationMs: 10_000,
  lastAppliedRevision,
  reportedAt,
});

describe("playback clock", () => {
  it("advances continuously between device reports", () => {
    const clock = rebasePlaybackClock(undefined, playing(1_000), 5_000);
    expect(playbackPositionAt(clock, 5_400)).toBe(1_400);
  });

  it("applies one early device sync and then ignores continuous position reports", () => {
    const initial = rebasePlaybackClock(undefined, playing(1_000), 5_000);
    const synchronized = rebasePlaybackClock(
      initial,
      playing(1_700, "session-1", 1, "2026-01-01T00:00:01.000Z"),
      6_000,
    );
    const continuous = rebasePlaybackClock(
      synchronized,
      playing(4_500, "session-1", 1, "2026-01-01T00:00:04.000Z"),
      9_000,
    );

    expect(playbackPositionAt(synchronized, 6_000)).toBe(1_700);
    expect(playbackPositionAt(synchronized, 6_300)).toBe(2_000);
    expect(playbackPositionAt(continuous, 9_000)).toBe(4_700);
  });

  it("re-anchors on pause, resume, and session changes", () => {
    const initial = rebasePlaybackClock(undefined, playing(4_000), 1_000);
    const paused = rebasePlaybackClock(initial, {
      ...playing(4_500, "session-1", 2, "2026-01-01T00:00:02.000Z"),
      state: "paused",
    }, 2_000);
    const resumed = rebasePlaybackClock(
      paused,
      playing(4_500, "session-1", 3, "2026-01-01T00:00:03.000Z"),
      3_000,
    );
    const newSession = rebasePlaybackClock(initial, playing(200, "session-2"), 2_000);
    const restarted = rebasePlaybackClock(initial, playing(0, "session-1", 2), 4_000);

    expect(playbackPositionAt(paused, 3_000)).toBe(4_500);
    expect(playbackPositionAt(resumed, 3_400)).toBe(4_900);
    expect(playbackPositionAt(newSession, 2_000)).toBe(200);
    expect(playbackPositionAt(restarted, 4_000)).toBe(0);
  });

  it("clamps playback to the artifact duration", () => {
    const clock = rebasePlaybackClock(undefined, playing(9_900), 1_000);
    expect(playbackPositionAt(clock, 2_000)).toBe(10_000);
  });
});

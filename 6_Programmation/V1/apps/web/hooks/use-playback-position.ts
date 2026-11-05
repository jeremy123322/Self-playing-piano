"use client";

import { useEffect, useRef, useState } from "react";
import type { ReportedState } from "@spp/contracts";
import { playbackPositionAt, rebasePlaybackClock, type PlaybackClock } from "@/lib/playback-clock";

export const usePlaybackPosition = (status: ReportedState) => {
  const clockRef = useRef<PlaybackClock | undefined>(undefined);
  const [positionMs, setPositionMs] = useState(status.positionMs);

  useEffect(() => {
    const nowMs = performance.now();
    clockRef.current = rebasePlaybackClock(clockRef.current, status, nowMs);
    setPositionMs(playbackPositionAt(clockRef.current, nowMs));
  }, [status]);

  useEffect(() => {
    let animationFrame = 0;
    const update = (nowMs: number) => {
      if (clockRef.current) setPositionMs(playbackPositionAt(clockRef.current, nowMs));
      animationFrame = requestAnimationFrame(update);
    };
    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return positionMs;
};

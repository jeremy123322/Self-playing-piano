"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { ArtifactNote } from "@spp/contracts";
import { cn } from "@/lib/utils";

interface PianoRollProps {
  notes: ArtifactNote[];
  positionMs: number;
  playing: boolean;
  className?: string;
}

const LOOK_AHEAD_MS = 6_000;
const KEYBOARD_HEIGHT = 54;
const STAGE_BACKGROUND = "#101013";
const GRID_LINE_COLOR = "rgba(255,255,255,.05)";
const KEYBOARD_BACKGROUND = "#d7d3ca";
const KEYBOARD_BACKGROUND_PLAYING = "#e8d9c2";
const KEY_BORDER_COLOR = "rgba(16,17,17,.35)";
const BLACK_KEY_COLOR = "#1a1b1b";

// keyIndex 0 is MIDI note 21 (A0). Semitone classes 1, 3, 6, 8, 10 relative to C are the black keys.
const isBlackKey = (keyIndex: number) => [1, 3, 6, 8, 10].includes((keyIndex + 9) % 12);

/** Reads the active theme's brand colors so falling notes match the light/dark palette. */
const readAccentColors = (canvas: HTMLCanvasElement) => {
  const computed = getComputedStyle(canvas);
  return {
    whiteKeyNote: computed.getPropertyValue("--primary").trim() || "#c7842e",
    blackKeyNote: computed.getPropertyValue("--info").trim() || "#3e6fd8",
  };
};

export const PianoRoll = ({ notes, positionMs, playing, className }: PianoRollProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const rollHeight = height - KEYBOARD_HEIGHT;
    const keyWidth = width / 88;
    const pixelsPerMs = rollHeight / LOOK_AHEAD_MS;
    const { whiteKeyNote, blackKeyNote } = readAccentColors(canvas);

    context.fillStyle = STAGE_BACKGROUND;
    context.fillRect(0, 0, width, rollHeight);
    context.strokeStyle = GRID_LINE_COLOR;
    for (let key = 0; key <= 88; key += 1) {
      context.beginPath();
      context.moveTo(key * keyWidth, 0);
      context.lineTo(key * keyWidth, rollHeight);
      context.stroke();
    }

    const activeKeys = new Set<number>();
    for (const note of notes) {
      const endMs = note.startMs + note.durationMs;
      if (note.startMs <= positionMs && endMs > positionMs) activeKeys.add(note.keyIndex);
      if (endMs < positionMs || note.startMs > positionMs + LOOK_AHEAD_MS) continue;
      const x = note.keyIndex * keyWidth + 1;
      const y = rollHeight - (note.startMs - positionMs) * pixelsPerMs;
      const noteHeight = Math.max(3, note.durationMs * pixelsPerMs);
      context.fillStyle = isBlackKey(note.keyIndex) ? blackKeyNote : whiteKeyNote;
      context.fillRect(x, y - noteHeight, Math.max(2, keyWidth - 2), noteHeight);
    }

    context.fillStyle = playing ? KEYBOARD_BACKGROUND_PLAYING : KEYBOARD_BACKGROUND;
    context.fillRect(0, rollHeight, width, KEYBOARD_HEIGHT);
    for (let key = 0; key < 88; key += 1) {
      const x = key * keyWidth;
      const keyIsBlack = isBlackKey(key);
      if (activeKeys.has(key) && !keyIsBlack) {
        context.fillStyle = whiteKeyNote;
        context.fillRect(x, rollHeight, keyWidth, KEYBOARD_HEIGHT);
      }
      context.strokeStyle = KEY_BORDER_COLOR;
      context.strokeRect(x, rollHeight, keyWidth, KEYBOARD_HEIGHT);
      if (keyIsBlack) {
        // Centered within this key's own slot (never spills into the neighboring key).
        context.fillStyle = activeKeys.has(key) ? blackKeyNote : BLACK_KEY_COLOR;
        context.fillRect(x + keyWidth * 0.15, rollHeight, keyWidth * 0.7, KEYBOARD_HEIGHT * 0.62);
      }
    }
  }, [notes, playing, positionMs, resolvedTheme]);

  return (
    <canvas
      aria-label="Animated piano roll"
      className={cn("block h-full w-full", className)}
      ref={canvasRef}
    />
  );
};

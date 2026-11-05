import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { processMidi } from "./process.js";

const fixturesDirectory = resolve(import.meta.dirname, "../../../firmware/esp32/midi_files");

const maximumPolyphony = (notes: ReturnType<typeof processMidi>["notes"]) => {
  const events = notes.flatMap((note) => [[note.startMs - note.activationLeadMs, 1] as const, [note.startMs + note.durationMs, -1] as const]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  return events.reduce((maximum, event) => {
    active += event[1];
    return Math.max(maximum, active);
  }, 0);
};

describe("MIDI processing", () => {
  it("processes every committed library fixture deterministically", () => {
    const fixtures = readdirSync(fixturesDirectory).filter((name) => /\.midi?$/i.test(name));
    expect(fixtures.length).toBeGreaterThanOrEqual(11);
    for (const fixture of fixtures) {
      const source = readFileSync(resolve(fixturesDirectory, fixture));
      const first = processMidi(source);
      const second = processMidi(source);
      expect(first.sha256, fixture).toBe(second.sha256);
      expect(first.noteCount, fixture).toBeGreaterThan(0);
      expect(maximumPolyphony(first.notes), fixture).toBeLessThanOrEqual(10);
      expect(first.artifact.byteLength, fixture).toBeLessThanOrEqual(128 * 1024);
      expect(first.notes.every((note) => note.startMs >= 5_000 && note.activationLeadMs === 20), fixture).toBe(true);
      expect(Math.min(...first.notes.map((note) => note.startMs)), fixture).toBe(5_000);
    }
  });

  it("warns about the currently unmapped top key", () => {
    const source = readFileSync(resolve(fixturesDirectory, "piano_88_notes_1s_each.mid"));
    const result = processMidi(source);
    expect(result.noteCount).toBe(87);
    expect(result.warnings).toContain("1 note(s) target currently unmapped piano keys and were ignored.");
  });

  it("reduces dense source files to ten notes", () => {
    const dense = new Midi();
    const track = dense.addTrack();
    for (let index = 0; index < 12; index += 1) {
      track.addNote({ midi: 40 + index, time: 0, duration: 1, velocity: (index + 1) / 12 });
    }
    const result = processMidi(dense.toArray());
    expect(maximumPolyphony(result.notes)).toBeLessThanOrEqual(10);
    expect(result.warnings.some((warning) => warning.includes("polyphony"))).toBe(true);
  });

  it("keeps musical and actuator timing separate for short notes", () => {
    const midi = new Midi();
    midi.addTrack().addNote({ midi: 60, time: 0, duration: 0.005, velocity: 1 });
    const result = processMidi(midi.toArray());
    expect(result.notes[0]).toMatchObject({
      startMs: 5_000,
      durationMs: 5,
      activationLeadMs: 20,
    });
    expect((result.notes[0]?.startMs ?? 0) - (result.notes[0]?.activationLeadMs ?? 0)).toBe(4_980);
    expect(result.durationMs).toBe(5_005);
  });
  it("sets the wait before the first playable note instead of adding to source silence", () => {
    const midi = new Midi();
    const track = midi.addTrack();
    track.addNote({ midi: 60, time: 3, duration: 0.5, velocity: 1 });
    track.addNote({ midi: 62, time: 4.25, duration: 0.5, velocity: 1 });

    const result = processMidi(midi.toArray());

    expect(result.notes.map((note) => note.startMs)).toEqual([5_000, 6_250]);
    expect(result.durationMs).toBe(6_750);
  });

  it("enforces polyphony across the expanded electrical activation window", () => {
    const midi = new Midi();
    const track = midi.addTrack();
    for (let index = 0; index < 10; index += 1) {
      track.addNote({ midi: 40 + index, time: 0, duration: 0.1, velocity: 0.5 });
    }
    track.addNote({ midi: 70, time: 0.11, duration: 0.1, velocity: 1 });
    const result = processMidi(midi.toArray());
    expect(maximumPolyphony(result.notes)).toBeLessThanOrEqual(10);
    expect(result.warnings.some((warning) => warning.includes("polyphony"))).toBe(true);
  });
});

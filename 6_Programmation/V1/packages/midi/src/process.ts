import { createHash } from "node:crypto";
import MidiPackage from "@tonejs/midi";
import {
  ARTIFACT_VERSION,
  LEGACY_V1_PROFILE,
  type ArtifactNote,
  type PianoProfile,
} from "@spp/contracts";
import { encodeArtifact } from "./artifact.js";

interface WorkingNote extends ArtifactNote {
  ordinal: number;
}

const { Midi } = MidiPackage;
const activationStartMs = (note: ArtifactNote) => note.startMs - note.activationLeadMs;

export interface ProcessedMidi {
  artifact: Uint8Array;
  sha256: string;
  sourceSha256: string;
  durationMs: number;
  noteCount: number;
  warnings: string[];
  notes: ArtifactNote[];
}

const enforceRetriggerGap = (notes: WorkingNote[], gapMs: number, warnings: string[]) => {
  const accepted: WorkingNote[] = [];
  let collisions = 0;

  for (let keyIndex = 0; keyIndex < 88; keyIndex += 1) {
    const keyNotes = notes
      .filter((note) => note.keyIndex === keyIndex)
      .sort((a, b) => a.startMs - b.startMs || b.velocity - a.velocity || a.ordinal - b.ordinal);
    const resolved: WorkingNote[] = [];

    for (const note of keyNotes) {
      const previous = resolved.at(-1);
      if (!previous || previous.startMs + previous.durationMs + gapMs <= activationStartMs(note)) {
        resolved.push(note);
        continue;
      }

      const trimmedDuration = activationStartMs(note) - gapMs - previous.startMs;
      if (trimmedDuration > 0) {
        previous.durationMs = Math.min(previous.durationMs, trimmedDuration);
        resolved.push(note);
        collisions += 1;
        continue;
      }

      collisions += 1;
      if (note.velocity > previous.velocity) resolved[resolved.length - 1] = note;
    }
    accepted.push(...resolved);
  }

  if (collisions > 0) warnings.push(`${collisions} same-key retrigger collision(s) were adjusted.`);
  return accepted;
};

const enforcePolyphony = (notes: WorkingNote[], maxPolyphony: number, warnings: string[]) => {
  const ordered = [...notes].sort((a, b) => activationStartMs(a) - activationStartMs(b) || a.startMs - b.startMs || b.velocity - a.velocity || a.keyIndex - b.keyIndex || a.ordinal - b.ordinal);
  const accepted: WorkingNote[] = [];
  let active: WorkingNote[] = [];
  let dropped = 0;

  for (let cursor = 0; cursor < ordered.length;) {
    const startMs = activationStartMs(ordered[cursor] as WorkingNote);
    const batch: WorkingNote[] = [];
    while (cursor < ordered.length && activationStartMs(ordered[cursor] as WorkingNote) === startMs) {
      const note = ordered[cursor];
      if (note) batch.push(note);
      cursor += 1;
    }

    active = active.filter((note) => note.startMs + note.durationMs > startMs);
    const strongest = [...active, ...batch]
      .sort((a, b) => b.velocity - a.velocity || a.startMs - b.startMs || a.keyIndex - b.keyIndex || a.ordinal - b.ordinal)
      .slice(0, maxPolyphony);
    const keep = new Set(strongest.map((note) => note.ordinal));

    for (const note of active) {
      if (keep.has(note.ordinal)) continue;
      note.durationMs = Math.max(0, Math.min(note.durationMs, startMs - note.startMs));
      dropped += 1;
    }
    for (const note of batch) {
      if (keep.has(note.ordinal)) accepted.push(note);
      else dropped += 1;
    }
    active = strongest;
  }

  if (dropped > 0) warnings.push(`${dropped} note(s) were removed or shortened to keep polyphony at ${maxPolyphony}.`);
  return accepted;
};

export const processMidi = (input: Uint8Array, profile: PianoProfile = LEGACY_V1_PROFILE): ProcessedMidi => {
  if (input.byteLength === 0 || input.byteLength > 1024 * 1024) throw new Error("MIDI must be between 1 byte and 1 MiB");
  if (new TextDecoder().decode(input.subarray(0, 4)) !== "MThd") throw new Error("File is not a Standard MIDI file");
  if (!Number.isInteger(profile.leadInMs) || profile.leadInMs < 0) throw new Error("Profile lead-in is invalid");
  if (!Number.isInteger(profile.activationLeadMs) || profile.activationLeadMs < 0 || profile.activationLeadMs > 255) {
    throw new Error("Profile activation lead must be between 0 and 255 ms");
  }
  if (profile.activationLeadMs > profile.leadInMs) throw new Error("Profile lead-in must cover activation lead");

  const midi = new Midi(input);
  const warnings: string[] = [];
  let outOfRange = 0;
  let unmapped = 0;
  let ordinal = 0;
  const sourceNotes: WorkingNote[] = [];

  for (const track of midi.tracks) {
    if (track.instrument.percussion) continue;
    for (const note of track.notes) {
      const keyIndex = note.midi - profile.midiStart;
      if (keyIndex < 0 || keyIndex >= profile.keyCount) {
        outOfRange += 1;
        continue;
      }
      if ((profile.keyMap[keyIndex] ?? -1) < 0) {
        unmapped += 1;
        continue;
      }
      sourceNotes.push({
        startMs: Math.max(0, Math.round(note.time * 1000)),
        durationMs: Math.max(1, Math.round(note.duration * 1000)),
        keyIndex,
        velocity: Math.max(1, Math.min(255, Math.round(note.velocity * 255))),
        flags: 0,
        activationLeadMs: profile.activationLeadMs,
        ordinal,
      });
      ordinal += 1;
    }
  }

  if (outOfRange > 0) warnings.push(`${outOfRange} note(s) outside MIDI ${profile.midiStart}–${profile.midiStart + profile.keyCount - 1} were ignored.`);
  if (unmapped > 0) warnings.push(`${unmapped} note(s) target currently unmapped piano keys and were ignored.`);
  if (sourceNotes.length === 0) throw new Error("MIDI contains no playable notes");

  const firstNoteMs = Math.min(...sourceNotes.map((note) => note.startMs));
  for (const note of sourceNotes) note.startMs = profile.leadInMs + note.startMs - firstNoteMs;

  const retriggered = enforceRetriggerGap(sourceNotes, profile.retriggerGapMs, warnings);
  const limited = enforcePolyphony(retriggered, profile.maxPolyphony, warnings)
    .filter((note) => note.durationMs > 0)
    .sort((a, b) => activationStartMs(a) - activationStartMs(b) || a.startMs - b.startMs || a.keyIndex - b.keyIndex || a.ordinal - b.ordinal);
  const notes = limited.map(({ ordinal: _ordinal, ...note }) => note);
  const durationMs = notes.reduce((maximum, note) => Math.max(maximum, note.startMs + note.durationMs), 0);
  const artifact = encodeArtifact({ version: ARTIFACT_VERSION, profileVersion: profile.version, durationMs, notes });

  return {
    artifact,
    sourceSha256: createHash("sha256").update(input).digest("hex"),
    sha256: createHash("sha256").update(artifact).digest("hex"),
    durationMs,
    noteCount: notes.length,
    warnings,
    notes,
  };
};

import {
  ARTIFACT_HEADER_SIZE,
  ARTIFACT_MAGIC,
  ARTIFACT_RECORD_SIZE,
  ARTIFACT_VERSION,
  MAX_ARTIFACT_BYTES,
  MAX_TIMELINE_MS,
  artifactProfileCompatible,
  type ArtifactDocument,
  type ArtifactNote,
} from "@spp/contracts";

const validateNote = (note: ArtifactNote) => {
  if (!Number.isInteger(note.startMs) || note.startMs < 0 || note.startMs > MAX_TIMELINE_MS) throw new Error("Invalid note start");
  if (!Number.isInteger(note.durationMs) || note.durationMs <= 0 || note.durationMs > MAX_TIMELINE_MS) throw new Error("Invalid note duration");
  if (note.startMs + note.durationMs > MAX_TIMELINE_MS) throw new Error("Invalid note end");
  if (!Number.isInteger(note.keyIndex) || note.keyIndex < 0 || note.keyIndex > 87) throw new Error("Invalid key index");
  if (!Number.isInteger(note.velocity) || note.velocity < 0 || note.velocity > 255) throw new Error("Invalid velocity");
  if (!Number.isInteger(note.flags) || note.flags < 0 || note.flags > 255) throw new Error("Invalid flags");
  if (!Number.isInteger(note.activationLeadMs) || note.activationLeadMs < 0 || note.activationLeadMs > 255 || note.activationLeadMs > note.startMs) {
    throw new Error("Invalid activation lead");
  }
};

export const encodeArtifact = (document: ArtifactDocument): Uint8Array => {
  if (document.version !== ARTIFACT_VERSION) throw new Error("Unsupported artifact version");
  if (!Number.isInteger(document.profileVersion) || document.profileVersion < 1 || document.profileVersion > 255) {
    throw new Error("Invalid profile version");
  }
  if (!Number.isInteger(document.durationMs) || document.durationMs < 0 || document.durationMs > MAX_TIMELINE_MS) {
    throw new Error("Invalid artifact duration");
  }
  if (document.notes.length === 0) throw new Error("Artifact must contain at least one note");
  const byteLength = ARTIFACT_HEADER_SIZE + document.notes.length * ARTIFACT_RECORD_SIZE;
  if (byteLength > MAX_ARTIFACT_BYTES) throw new Error("Processed artifact exceeds 128 KiB");

  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode(ARTIFACT_MAGIC), 0);
  view.setUint8(4, ARTIFACT_VERSION);
  view.setUint8(5, document.profileVersion);
  view.setUint16(6, ARTIFACT_RECORD_SIZE, true);
  view.setUint32(8, document.notes.length, true);
  view.setUint32(12, document.durationMs, true);

  document.notes.forEach((note, index) => {
    validateNote(note);
    const offset = ARTIFACT_HEADER_SIZE + index * ARTIFACT_RECORD_SIZE;
    view.setUint32(offset, note.startMs, true);
    view.setUint32(offset + 4, note.durationMs, true);
    view.setUint8(offset + 8, note.keyIndex);
    view.setUint8(offset + 9, note.velocity);
    view.setUint8(offset + 10, note.flags);
    view.setUint8(offset + 11, note.activationLeadMs);
  });
  const maximumEnd = document.notes.reduce((maximum, note) => Math.max(maximum, note.startMs + note.durationMs), 0);
  if (document.durationMs !== maximumEnd) throw new Error("Artifact duration does not match its notes");

  return output;
};

export const decodeArtifact = (input: Uint8Array): ArtifactDocument => {
  if (input.byteLength < ARTIFACT_HEADER_SIZE || input.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error("Invalid artifact size");
  }

  const magic = new TextDecoder().decode(input.subarray(0, 4));
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (magic !== ARTIFACT_MAGIC) throw new Error("Invalid artifact magic");
  const version = view.getUint8(4);
  const profileVersion = view.getUint8(5);
  if (version !== 1 && version !== ARTIFACT_VERSION) throw new Error("Unsupported artifact version");
  if (!artifactProfileCompatible(version, profileVersion)) throw new Error("Incompatible artifact profile");
  if (view.getUint16(6, true) !== ARTIFACT_RECORD_SIZE) throw new Error("Unsupported record size");

  const recordCount = view.getUint32(8, true);
  if (recordCount === 0 || ARTIFACT_HEADER_SIZE + recordCount * ARTIFACT_RECORD_SIZE !== input.byteLength) {
    throw new Error("Artifact length does not match record count");
  }

  const notes = Array.from({ length: recordCount }, (_, index): ArtifactNote => {
    const offset = ARTIFACT_HEADER_SIZE + index * ARTIFACT_RECORD_SIZE;
    const reservedOrLead = view.getUint8(offset + 11);
    if (version === 1 && reservedOrLead !== 0) throw new Error("Legacy artifact reserved byte must be zero");
    return {
      startMs: view.getUint32(offset, true),
      durationMs: view.getUint32(offset + 4, true),
      keyIndex: view.getUint8(offset + 8),
      velocity: view.getUint8(offset + 9),
      flags: view.getUint8(offset + 10),
      activationLeadMs: version >= 2 ? reservedOrLead : 0,
    };
  });
  notes.forEach(validateNote);
  const durationMs = view.getUint32(12, true);
  const maximumEnd = notes.reduce((maximum, note) => Math.max(maximum, note.startMs + note.durationMs), 0);
  if (durationMs !== maximumEnd) throw new Error("Artifact duration does not match its notes");

  return {
    version,
    profileVersion,
    durationMs,
    notes,
  };
};

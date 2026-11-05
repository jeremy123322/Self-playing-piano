import type { ArtifactNote } from "@spp/contracts";

const ARTIFACT_MAGIC = "SPP1";
const HEADER_BYTES = 16;
const NOTE_RECORD_BYTES = 12;

/** Decodes the binary `.spp` artifact format produced by `@spp/midi` into note events for the falling-notes roll. */
export const decodeArtifactNotes = (buffer: ArrayBuffer): ArtifactNote[] => {
  if (buffer.byteLength < HEADER_BYTES) return [];
  const view = new DataView(buffer);
  const magic = new TextDecoder().decode(buffer.slice(0, 4));
  if (magic !== ARTIFACT_MAGIC) return [];
  const version = view.getUint8(4);
  if (version !== 1 && version !== 2) return [];

  const noteCount = view.getUint32(8, true);
  const expectedBytes = HEADER_BYTES + noteCount * NOTE_RECORD_BYTES;
  if (expectedBytes !== buffer.byteLength) return [];

  return Array.from({ length: noteCount }, (_, index) => {
    const offset = HEADER_BYTES + index * NOTE_RECORD_BYTES;
    return {
      startMs: view.getUint32(offset, true),
      durationMs: view.getUint32(offset + 4, true),
      keyIndex: view.getUint8(offset + 8),
      velocity: view.getUint8(offset + 9),
      flags: view.getUint8(offset + 10),
      activationLeadMs: version >= 2 ? view.getUint8(offset + 11) : 0,
    };
  });
};

export const fetchArtifactNotes = async (songId: string): Promise<ArtifactNote[]> => {
  const response = await fetch(`/api/songs/${songId}/artifact`);
  if (!response.ok) throw new Error("Preview unavailable");
  return decodeArtifactNotes(await response.arrayBuffer());
};

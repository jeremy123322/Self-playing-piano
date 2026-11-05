import { randomUUID } from "node:crypto";
import { asc, eq, isNull } from "drizzle-orm";
import { artifacts, songs } from "@spp/database";
import { ARTIFACT_VERSION, LEGACY_V1_PROFILE } from "@spp/contracts";
import { processMidi } from "@spp/midi";
import { adminSession } from "@/lib/authorization";
import { database, storage } from "@/lib/services";

const midiFileName = /\.midi?$/i;

export const GET = async () => {
  if (!await adminSession()) return Response.json({ error: "Administrator authentication required" }, { status: 401 });
  const rows = await database().db
    .select({ id: songs.id, title: songs.title })
    .from(songs)
    .where(isNull(songs.archivedAt))
    .orderBy(asc(songs.createdAt));
  return Response.json({ songs: rows });
};

export const POST = async (request: Request) => {
  if (!await adminSession()) return Response.json({ error: "Administrator authentication required" }, { status: 401 });
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "A MIDI file is required" }, { status: 400 });
  if (!midiFileName.test(file.name)) return Response.json({ error: "Only .mid and .midi files are accepted" }, { status: 400 });
  if (file.size > 1024 * 1024) return Response.json({ error: "MIDI files are limited to 1 MiB" }, { status: 413 });

  try {
    const source = new Uint8Array(await file.arrayBuffer());
    const processed = processMidi(source, LEGACY_V1_PROFILE);
    const [duplicate] = await database().db.select({ id: songs.id }).from(songs).where(eq(songs.originalSha256, processed.sourceSha256)).limit(1);
    if (duplicate) return Response.json({ error: "This MIDI has already been uploaded", songId: duplicate.id }, { status: 409 });

    const songId = randomUUID();
    const artifactId = randomUUID();
    const originalKey = `songs/${songId}/original.mid`;
    const artifactKey = `songs/${songId}/legacy-v1.spp`;
    const objectStorage = storage();
    await objectStorage.put(originalKey, source, "audio/midi");
    try {
      await objectStorage.put(artifactKey, processed.artifact, "application/vnd.self-playing-piano");
      const title = String(formData.get("title") || file.name.replace(midiFileName, "").replace(/\.mid$/i, ""));
      const artistValue = String(formData.get("artist") || "").trim();
      await database().db.transaction(async (transaction) => {
        await transaction.insert(songs).values({
          id: songId,
          title,
          artist: artistValue || null,
          status: "ready",
          originalObjectKey: originalKey,
          originalSha256: processed.sourceSha256,
          originalBytes: source.byteLength,
          durationMs: processed.durationMs,
          noteCount: processed.noteCount,
          warnings: processed.warnings,
        });
        await transaction.insert(artifacts).values({
          id: artifactId,
          songId,
          profileId: LEGACY_V1_PROFILE.id,
          profileVersion: LEGACY_V1_PROFILE.version,
          formatVersion: ARTIFACT_VERSION,
          processorVersion: 1,
          objectKey: artifactKey,
          sha256: processed.sha256,
          byteSize: processed.artifact.byteLength,
          noteCount: processed.noteCount,
          durationMs: processed.durationMs,
          isCurrent: true,
        });
      });
      return Response.json({ id: songId, artifactId, warnings: processed.warnings }, { status: 201 });
    } catch (error) {
      await Promise.allSettled([objectStorage.delete(originalKey), objectStorage.delete(artifactKey)]);
      throw error;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "MIDI processing failed" }, { status: 422 });
  }
};

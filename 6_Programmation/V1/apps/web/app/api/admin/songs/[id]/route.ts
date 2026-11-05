import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { artifacts, songs } from "@spp/database";
import { ARTIFACT_VERSION, LEGACY_V1_PROFILE } from "@spp/contracts";
import { processMidi } from "@spp/midi";
import { z } from "zod";
import { adminSession } from "@/lib/authorization";
import { database, storage } from "@/lib/services";

const updateSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), artist: z.string().trim().max(200).nullable().optional() });

const requireAdmin = async () => Boolean(await adminSession());

export const PATCH = async (request: Request, context: { params: Promise<{ id: string }> }) => {
  if (!await requireAdmin()) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = updateSchema.safeParse(await request.json());
  if (!body.success) return Response.json({ error: "Invalid song metadata" }, { status: 400 });
  const { id } = await context.params;
  const [updated] = await database().db.update(songs).set({ ...body.data, updatedAt: new Date() }).where(eq(songs.id, id)).returning();
  return updated ? Response.json(updated) : Response.json({ error: "Song not found" }, { status: 404 });
};

export const POST = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  if (!await requireAdmin()) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const [song] = await database().db.select().from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) return Response.json({ error: "Song not found" }, { status: 404 });
  const objectStorage = storage();
  const originalResponse = await fetch(await objectStorage.getDownloadUrl(song.originalObjectKey, 300));
  if (!originalResponse.ok) return Response.json({ error: "Original MIDI is unavailable" }, { status: 502 });
  const processed = processMidi(new Uint8Array(await originalResponse.arrayBuffer()), LEGACY_V1_PROFILE);
  const artifactId = randomUUID();
  const newObjectKey = `songs/${id}/legacy-v1-${artifactId}.spp`;
  await objectStorage.put(newObjectKey, processed.artifact, "application/vnd.self-playing-piano");
  try {
    await database().db.transaction(async (transaction) => {
      const [lockedSong] = await transaction.select({ id: songs.id }).from(songs).where(eq(songs.id, id)).for("update").limit(1);
      if (!lockedSong) throw new Error("Song no longer exists");
      const [latest] = await transaction.select({ processorVersion: artifacts.processorVersion }).from(artifacts)
        .where(and(eq(artifacts.songId, id), eq(artifacts.profileId, LEGACY_V1_PROFILE.id)))
        .orderBy(desc(artifacts.processorVersion)).limit(1);
      await transaction.update(artifacts).set({ isCurrent: false })
        .where(and(eq(artifacts.songId, id), eq(artifacts.profileId, LEGACY_V1_PROFILE.id), eq(artifacts.isCurrent, true)));
      await transaction.insert(artifacts).values({
        id: artifactId, songId: id, profileId: LEGACY_V1_PROFILE.id,
        profileVersion: LEGACY_V1_PROFILE.version,
        formatVersion: ARTIFACT_VERSION, processorVersion: (latest?.processorVersion ?? 0) + 1,
        objectKey: newObjectKey, sha256: processed.sha256,
        byteSize: processed.artifact.byteLength, noteCount: processed.noteCount,
        durationMs: processed.durationMs, isCurrent: true,
      });
      await transaction.update(songs).set({ durationMs: processed.durationMs, noteCount: processed.noteCount, warnings: processed.warnings, status: "ready", errorMessage: null, updatedAt: new Date() }).where(eq(songs.id, id));
    });
  } catch (error) {
    await objectStorage.delete(newObjectKey).catch(() => undefined);
    throw error;
  }
  return Response.json({ id, artifactId, warnings: processed.warnings });
};

export const DELETE = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  if (!await requireAdmin()) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const [song] = await database().db.select({ id: songs.id }).from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) return Response.json({ error: "Song not found" }, { status: 404 });
  await database().db.update(songs).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(songs.id, id));
  return new Response(null, { status: 204 });
};

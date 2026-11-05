import { asc, desc, eq } from "drizzle-orm";
import { commands, pianos, playbackSessions, songs } from "@spp/database";
import { adminSession } from "@/lib/authorization";
import { DEVICE_ONLINE_WINDOW_MS } from "@/lib/piano-presence";
import { database } from "@/lib/services";
import type { DiagnosticsResponse } from "@/lib/diagnostics-types";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 15;

const fetchRecentSessions = async (pianoId: string) => {
  const db = database().db;
  const rows = await db
    .select({
      id: playbackSessions.id,
      state: playbackSessions.state,
      positionMs: playbackSessions.positionMs,
      requestedAt: playbackSessions.requestedAt,
      startedAt: playbackSessions.startedAt,
      endedAt: playbackSessions.endedAt,
      errorMessage: playbackSessions.errorMessage,
      songTitle: songs.title,
    })
    .from(playbackSessions)
    .leftJoin(songs, eq(songs.id, playbackSessions.songId))
    .where(eq(playbackSessions.pianoId, pianoId))
    .orderBy(desc(playbackSessions.requestedAt))
    .limit(HISTORY_LIMIT);

  return rows.map((row) => ({
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  }));
};

const fetchRecentCommands = async (pianoId: string) => {
  const db = database().db;
  const rows = await db
    .select({
      id: commands.id,
      type: commands.type,
      revision: commands.revision,
      status: commands.status,
      errorMessage: commands.errorMessage,
      createdAt: commands.createdAt,
      publishedAt: commands.publishedAt,
      acknowledgedAt: commands.acknowledgedAt,
    })
    .from(commands)
    .where(eq(commands.pianoId, pianoId))
    .orderBy(desc(commands.createdAt))
    .limit(HISTORY_LIMIT);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  }));
};

export const GET = async () => {
  if (!await adminSession()) return Response.json({ error: "Administrator authentication required" }, { status: 401 });

  const [piano] = await database().db.select().from(pianos).orderBy(asc(pianos.createdAt)).limit(1);
  if (!piano) return Response.json({ error: "No piano is configured" }, { status: 404 });

  const online = Boolean(piano.online && piano.lastSeenAt && Date.now() - piano.lastSeenAt.getTime() < DEVICE_ONLINE_WINDOW_MS);
  const [recentSessions, recentCommands] = await Promise.all([fetchRecentSessions(piano.id), fetchRecentCommands(piano.id)]);

  const response: DiagnosticsResponse = {
    piano: {
      id: piano.id,
      name: piano.name,
      state: online ? piano.state : "offline",
      online,
      firmwareVersion: piano.firmwareVersion,
      profileId: piano.firmwareProfileId ?? piano.profileId,
      profileVersion: piano.firmwareProfileVersion ?? 0,
      positionMs: piano.positionMs,
      durationMs: piano.durationMs,
      activeSessionId: piano.activeSessionId,
      commandRevision: piano.commandRevision,
      lastAppliedRevision: piano.lastAppliedRevision,
      lastHandledRevision: piano.lastHandledRevision,
      lastSeenAt: piano.lastSeenAt?.toISOString() ?? null,
      errorCode: online ? piano.errorCode : null,
      errorMessage: online ? piano.errorMessage : null,
      updatedAt: piano.updatedAt.toISOString(),
    },
    recentSessions,
    recentCommands,
  };
  return Response.json(response);
};

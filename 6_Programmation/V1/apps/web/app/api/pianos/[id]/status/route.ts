import { eq, or } from "drizzle-orm";
import { pianos, playbackSessions } from "@spp/database";
import type { ReportedState } from "@spp/contracts";
import { database } from "@/lib/services";
import { DEVICE_ONLINE_WINDOW_MS } from "@/lib/piano-presence";

export const dynamic = "force-dynamic";

export const GET = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const [piano] = await database().db.select().from(pianos).where(or(eq(pianos.id, id), eq(pianos.slug, id))).limit(1);
  if (!piano) return Response.json({ error: "Piano not found" }, { status: 404 });
  const [activeSession] = piano.activeSessionId
    ? await database().db.select({ songId: playbackSessions.songId }).from(playbackSessions).where(eq(playbackSessions.id, piano.activeSessionId)).limit(1)
    : [undefined];
  const online = Boolean(piano.online && piano.lastSeenAt && Date.now() - piano.lastSeenAt.getTime() < DEVICE_ONLINE_WINDOW_MS);
  const reported: ReportedState = {
    pianoId: piano.id,
    state: online ? piano.state : "offline",
    online,
    ...(piano.activeSessionId ? { sessionId: piano.activeSessionId } : {}),
    ...(activeSession ? { songId: activeSession.songId } : {}),
    positionMs: piano.positionMs,
    durationMs: piano.durationMs,
    firmwareVersion: piano.firmwareVersion ?? "unknown",
    profileId: piano.firmwareProfileId ?? piano.profileId,
    profileVersion: piano.firmwareProfileVersion ?? 0,
    lastAppliedRevision: piano.lastAppliedRevision,
    lastHandledRevision: piano.lastHandledRevision,
    reportedAt: (piano.lastReportedAt ?? piano.lastSeenAt ?? piano.updatedAt).toISOString(),
    ...(online && piano.errorCode ? {
      error: {
        code: piano.errorCode,
        message: piano.errorMessage ?? piano.errorCode,
      },
    } : {}),
  };
  return Response.json(reported);
};

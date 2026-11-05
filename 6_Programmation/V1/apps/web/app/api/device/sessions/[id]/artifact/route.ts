import { and, eq } from "drizzle-orm";
import { artifacts, playbackSessions } from "@spp/database";
import { authenticateDevice } from "@/lib/device-auth";
import { database, storage } from "@/lib/services";

export const GET = async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const [session] = await database().db
    .select({ pianoId: playbackSessions.pianoId, state: playbackSessions.state, objectKey: artifacts.objectKey })
    .from(playbackSessions)
    .innerJoin(artifacts, eq(artifacts.id, playbackSessions.artifactId))
    .where(and(eq(playbackSessions.id, id)))
    .limit(1);
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  if (!await authenticateDevice(request, session.pianoId)) return Response.json({ error: "Invalid device token" }, { status: 401 });
  if (["completed", "stopped", "failed"].includes(session.state)) return Response.json({ error: "Session is no longer active" }, { status: 409 });
  return Response.redirect(await storage().getDownloadUrl(session.objectKey, 300), 307);
};

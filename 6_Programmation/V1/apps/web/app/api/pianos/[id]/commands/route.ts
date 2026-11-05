import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { artifacts, commands, pianoProfiles, pianos, playbackSessions, songs } from "@spp/database";
import {
  MAX_COMMAND_REVISION,
  artifactProfileCompatible,
  commandTypes,
  type DesiredCommand,
} from "@spp/contracts";
import { desiredTopic } from "@spp/infrastructure";
import { z } from "zod";
import { controllerSession } from "@/lib/authorization";
import { deliverCommand } from "@/lib/command-delivery";
import { database, mqttPublisher } from "@/lib/services";
import { DEVICE_ONLINE_WINDOW_MS } from "@/lib/piano-presence";
import { commandRequiresActiveSession, isAdminCommand } from "@/lib/command-policy";
import { commandCanBeAdmitted, commandShouldBeRetained } from "@/lib/command-admission";
import { profileMismatchMessage, profilesMatch } from "@/lib/profile-compatibility";

const commandSchema = z.object({
  type: z.enum(commandTypes),
  songId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
});

interface CommandResult {
  desired: DesiredCommand;
  isNewSession: boolean;
}

const failDefiniteDispatch = async (result: CommandResult, message: string) => {
  await database().db.transaction(async (transaction) => {
    const failed = await transaction.update(commands).set({ status: "dispatch_failed", errorMessage: message }).where(and(
      eq(commands.id, result.desired.commandId),
      eq(commands.status, "pending"),
    )).returning({ id: commands.id });
    if (failed.length === 0 || !result.isNewSession) return;
    await transaction.update(playbackSessions).set({ state: "failed", endedAt: new Date(), errorMessage: message }).where(eq(playbackSessions.id, result.desired.sessionId));
    await transaction.update(pianos).set({ state: "idle", activeSessionId: null, updatedAt: new Date() })
      .where(and(eq(pianos.id, result.desired.pianoId), eq(pianos.activeSessionId, result.desired.sessionId)));
  });
};

const markDispatchUncertain = async (commandId: string, message: string) => {
  await database().db.update(commands).set({ status: "dispatch_uncertain", errorMessage: message }).where(and(
    eq(commands.id, commandId),
    eq(commands.status, "pending"),
  ));
};

export const POST = async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await controllerSession();
  if (!session) return Response.json({ error: "Controller authentication required" }, { status: 401 });

  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid command" }, { status: 400 });
  if (isAdminCommand(parsed.data.type) && session.user.role !== "admin") {
    return Response.json({ error: "Administrator authentication required" }, { status: 403 });
  }
  const { id } = await context.params;

  let result: CommandResult;
  try {
    result = await database().db.transaction(async (transaction): Promise<CommandResult> => {
      const [piano] = await transaction.select().from(pianos)
        .where(sql`${pianos.id}::text = ${id} OR ${pianos.slug} = ${id}`)
        .for("update").limit(1);
      if (!piano) throw new Error("NOT_FOUND:Piano not found");
      const online = piano.online && piano.lastSeenAt && Date.now() - piano.lastSeenAt.getTime() < DEVICE_ONLINE_WINDOW_MS;
      if (!online) throw new Error("OFFLINE:The piano is offline");

      const [latestCommand] = await transaction.select({ revision: commands.revision, status: commands.status })
        .from(commands)
        .where(eq(commands.pianoId, piano.id))
        .orderBy(desc(commands.revision))
        .limit(1);
      if (latestCommand && Number(latestCommand.revision) === Number(piano.commandRevision) &&
          !commandCanBeAdmitted(latestCommand.status, parsed.data.type)) {
        throw new Error("CONFLICT:The previous command has not been acknowledged by the piano");
      }

      const revision = Number(piano.commandRevision) + 1;
      if (!Number.isSafeInteger(revision) || revision > MAX_COMMAND_REVISION) {
        throw new Error("EXHAUSTED:The command revision range is exhausted");
      }
      const commandId = randomUUID();
      const issuedAtMs = Date.now();
      const expiresAtMs = issuedAtMs + 30_000;
      const issuedAtEpochSeconds = Math.floor(issuedAtMs / 1000);
      const expiresAt = new Date(expiresAtMs).toISOString();
      const expiresAtEpochSeconds = Math.floor(expiresAtMs / 1000);

      if (parsed.data.type === "play") {
        if (!parsed.data.songId) throw new Error("INVALID:A song is required");
        if (piano.activeSessionId || piano.state !== "idle") throw new Error("CONFLICT:The piano is already in use");
        const [profile] = await transaction.select({ version: pianoProfiles.version })
          .from(pianoProfiles)
          .where(eq(pianoProfiles.id, piano.profileId))
          .limit(1);
        if (!profile) throw new Error("INVALID:The piano profile is not configured");
        const configuredProfile = { id: piano.profileId, version: profile.version };
        const firmwareProfile = {
          id: piano.firmwareProfileId ?? "",
          version: piano.firmwareProfileVersion ?? undefined,
        };
        if (!profilesMatch(configuredProfile, firmwareProfile)) {
          throw new Error(`CONFLICT:${profileMismatchMessage(configuredProfile, firmwareProfile)}`);
        }

        const [artifact] = await transaction
          .select({
            id: artifacts.id,
            sha256: artifacts.sha256,
            byteSize: artifacts.byteSize,
            durationMs: artifacts.durationMs,
            formatVersion: artifacts.formatVersion,
            profileVersion: artifacts.profileVersion,
          })
          .from(artifacts)
          .innerJoin(songs, eq(songs.id, artifacts.songId))
          .where(and(
            eq(artifacts.songId, parsed.data.songId),
            eq(artifacts.profileId, piano.profileId),
            eq(artifacts.isCurrent, true),
            eq(songs.status, "ready"),
            isNull(songs.archivedAt),
          ))
          .limit(1);
        if (!artifact) throw new Error("INVALID:Song is not ready for this piano");
        if (!artifactProfileCompatible(artifact.formatVersion, artifact.profileVersion, configuredProfile.version)) {
          throw new Error("INVALID:The song artifact is incompatible with the piano firmware profile");
        }

        const sessionId = randomUUID();
        const desired: DesiredCommand = {
          commandId,
          revision,
          sessionId,
          type: "play",
          pianoId: piano.id,
          issuedAtEpochSeconds,
          songId: parsed.data.songId,
          artifactId: artifact.id,
          artifactSha256: artifact.sha256,
          artifactBytes: artifact.byteSize,
          artifactVersion: artifact.formatVersion,
          profileId: configuredProfile.id,
          profileVersion: artifact.profileVersion,
          expiresAt,
          expiresAtEpochSeconds,
        };
        await transaction.insert(playbackSessions).values({ id: sessionId, pianoId: piano.id, songId: parsed.data.songId, artifactId: artifact.id });
        await transaction.update(pianos).set({ state: "preparing", activeSessionId: sessionId, commandRevision: revision, durationMs: artifact.durationMs, positionMs: 0, updatedAt: new Date() }).where(eq(pianos.id, piano.id));
        await transaction.insert(commands).values({ id: commandId, pianoId: piano.id, sessionId, type: "play", revision, payload: desired });
        return { isNewSession: true, desired };
      }

      if (commandRequiresActiveSession(parsed.data.type)) {
        if (!piano.activeSessionId || parsed.data.sessionId !== piano.activeSessionId) throw new Error("CONFLICT:The active session has changed");
      }
      if (parsed.data.type === "enter_provisioning" && piano.state !== "idle") throw new Error("CONFLICT:Provisioning can only start while idle");

      const sessionId = piano.activeSessionId ?? randomUUID();
      const [activeSession] = piano.activeSessionId
        ? await transaction.select().from(playbackSessions).where(eq(playbackSessions.id, piano.activeSessionId)).limit(1)
        : [undefined];
      const desired: DesiredCommand = {
        commandId,
        revision,
        sessionId,
        type: parsed.data.type,
        pianoId: piano.id,
        issuedAtEpochSeconds,
        ...(activeSession ? { songId: activeSession.songId, artifactId: activeSession.artifactId } : {}),
        expiresAt,
        expiresAtEpochSeconds,
      };
      await transaction.update(pianos).set({ commandRevision: revision, updatedAt: new Date() }).where(eq(pianos.id, piano.id));
      await transaction.insert(commands).values({ id: commandId, pianoId: piano.id, sessionId: activeSession?.id ?? null, type: parsed.data.type, revision, payload: desired });
      return { isNewSession: false, desired };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command failed";
    const [code, detail] = message.includes(":") ? message.split(/:(.*)/s, 2) : ["ERROR", message];
    const status = code === "NOT_FOUND" ? 404 : code === "OFFLINE" ? 503 :
      code === "CONFLICT" || code === "EXHAUSTED" ? 409 : 400;
    return Response.json({ error: detail }, { status });
  }

  const delivery = await deliverCommand({
    publisher: mqttPublisher(),
    topic: desiredTopic(result.desired.pianoId),
    payload: JSON.stringify(result.desired),
    retain: commandShouldBeRetained(result.desired.type),
    onDefiniteFailure: (message) => failDefiniteDispatch(result, message),
    onUncertain: (message) => markDispatchUncertain(result.desired.commandId, message),
    onPublished: () => database().db.update(commands).set({ status: "published", publishedAt: new Date(), errorMessage: null })
      .where(and(
        eq(commands.id, result.desired.commandId),
        eq(commands.status, "pending"),
      )).then(() => undefined),
  });
  if (delivery === "failed") return Response.json({ error: "The command broker is unavailable; nothing was sent" }, { status: 503 });
  return Response.json({ ...result.desired, delivery }, { status: 202 });
};

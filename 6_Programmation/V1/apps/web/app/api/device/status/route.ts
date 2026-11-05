import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { commands, pianoProfiles, pianos, playbackSessions } from "@spp/database";
import {
  MAX_COMMAND_REVISION,
  MAX_TIMELINE_MS,
  commandResults,
  pianoStates,
  sessionOutcomes,
} from "@spp/contracts";
import { z } from "zod";
import { authenticateDevice } from "@/lib/device-auth";
import { database } from "@/lib/services";
import { planStatusReconciliation } from "@/lib/status-reconciliation";
import { profileMismatchMessage, profilesMatch } from "@/lib/profile-compatibility";
import { statusIsCurrentOrNewer } from "@/lib/status-ordering";

const errorSchema = z.object({ code: z.string().max(100), message: z.string().max(500) });
const statusSchema = z.object({
  pianoId: z.string().uuid(),
  state: z.enum(pianoStates),
  online: z.boolean(),
  sessionId: z.string().uuid().optional(),
  songId: z.string().uuid().optional(),
  positionMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  durationMs: z.number().int().min(0).max(MAX_TIMELINE_MS),
  firmwareVersion: z.string().max(100),
  profileId: z.string().max(100),
  profileVersion: z.number().int().min(1).max(255).optional(),
  lastAppliedRevision: z.number().int().min(0).max(MAX_COMMAND_REVISION),
  lastHandledRevision: z.number().int().min(0).max(MAX_COMMAND_REVISION),
  reportedAt: z.string().datetime(),
  acknowledgement: z.object({
    commandId: z.string().uuid(),
    revision: z.number().int().positive(),
    result: z.enum(commandResults),
    error: errorSchema.optional(),
  }).optional(),
  sessionOutcome: z.enum(sessionOutcomes).optional(),
  error: errorSchema.optional(),
});

const terminalSessionStates: Array<"completed" | "stopped" | "failed"> = ["completed", "stopped", "failed"];
const mutableCommandStates: Array<"pending" | "published" | "dispatch_uncertain"> = ["pending", "published", "dispatch_uncertain"];

const activeSessionState = (state: (typeof pianoStates)[number]) => {
  if (state === "playing") return "playing" as const;
  if (state === "paused") return "paused" as const;
  if (state === "preparing" || state === "ready") return "preparing" as const;
  return undefined;
};

export const POST = async (request: Request) => {
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid reported state" }, { status: 400 });
  if (!await authenticateDevice(request, parsed.data.pianoId)) return Response.json({ error: "Invalid device token" }, { status: 401 });

  const reported = parsed.data;
  const now = new Date();
  const reportedAt = new Date(reported.reportedAt);
  await database().db.transaction(async (transaction) => {
    const [piano] = await transaction.select().from(pianos).where(eq(pianos.id, reported.pianoId)).for("update").limit(1);
    if (!piano) return;
    if (!statusIsCurrentOrNewer({
      lastHandledRevision: Number(piano.lastHandledRevision),
      lastAppliedRevision: Number(piano.lastAppliedRevision),
      reportedAt: piano.lastReportedAt ?? new Date(0),
    }, {
      lastHandledRevision: reported.lastHandledRevision,
      lastAppliedRevision: reported.lastAppliedRevision,
      reportedAt,
    })) {
      await transaction.update(pianos).set({
        online: reported.online,
        lastSeenAt: now,
        updatedAt: now,
      }).where(eq(pianos.id, reported.pianoId));
      return;
    }
    const [profile] = await transaction.select({ version: pianoProfiles.version })
      .from(pianoProfiles)
      .where(eq(pianoProfiles.id, piano.profileId))
      .limit(1);
    if (!profile) return;

    const configuredProfile = { id: piano.profileId, version: profile.version };
    const firmwareProfile = { id: reported.profileId, version: reported.profileVersion };
    if (!profilesMatch(configuredProfile, firmwareProfile)) {
      await transaction.update(pianos).set({
        online: reported.online,
        firmwareVersion: reported.firmwareVersion,
        firmwareProfileId: reported.profileId,
        firmwareProfileVersion: reported.profileVersion ?? null,
        lastAppliedRevision: Math.max(reported.lastAppliedRevision, Number(piano.lastAppliedRevision)),
        lastHandledRevision: Math.max(reported.lastHandledRevision, Number(piano.lastHandledRevision)),
        state: "error",
        errorCode: "profile_mismatch",
        errorMessage: profileMismatchMessage(configuredProfile, firmwareProfile),
        lastSeenAt: now,
        lastReportedAt: reportedAt,
        updatedAt: now,
      }).where(eq(pianos.id, reported.pianoId));

      if (reported.acknowledgement) {
        await transaction.update(commands).set({
          status: reported.acknowledgement.result === "accepted" ? "acknowledged" : "rejected",
          acknowledgedAt: now,
          errorMessage: reported.acknowledgement.error?.message ?? null,
        }).where(and(
          eq(commands.id, reported.acknowledgement.commandId),
          eq(commands.pianoId, reported.pianoId),
          eq(commands.revision, reported.acknowledgement.revision),
          inArray(commands.status, mutableCommandStates),
        ));
        if (reported.acknowledgement.result === "rejected") {
          const [rejected] = await transaction.select({
            type: commands.type,
            sessionId: commands.sessionId,
          }).from(commands).where(and(
            eq(commands.id, reported.acknowledgement.commandId),
            eq(commands.pianoId, reported.pianoId),
          )).limit(1);
          if (rejected?.type === "play" && rejected.sessionId &&
              rejected.sessionId === piano.activeSessionId) {
            await transaction.update(playbackSessions).set({
              state: "failed",
              endedAt: now,
              errorMessage: reported.acknowledgement.error?.message ?? "Device rejected Play",
            }).where(and(
              eq(playbackSessions.id, rejected.sessionId),
              notInArray(playbackSessions.state, terminalSessionStates),
            ));
            await transaction.update(pianos).set({
              activeSessionId: null,
              updatedAt: now,
            }).where(and(
              eq(pianos.id, reported.pianoId),
              eq(pianos.activeSessionId, rejected.sessionId),
            ));
          }
        }
      }
      if (reported.sessionOutcome === "stopped" && reported.sessionId &&
          reported.sessionId === piano.activeSessionId) {
        await transaction.update(playbackSessions).set({
          state: "stopped",
          positionMs: reported.positionMs,
          endedAt: sql`COALESCE(${playbackSessions.endedAt}, NOW())`,
        }).where(and(
          eq(playbackSessions.id, reported.sessionId),
          eq(playbackSessions.pianoId, reported.pianoId),
          notInArray(playbackSessions.state, terminalSessionStates),
        ));
        await transaction.update(pianos).set({
          activeSessionId: null,
          positionMs: reported.positionMs,
          updatedAt: now,
        }).where(and(
          eq(pianos.id, reported.pianoId),
          eq(pianos.activeSessionId, reported.sessionId),
        ));
      }
      return;
    }

    const plan = planStatusReconciliation({
      activeSessionId: piano.activeSessionId,
      commandRevision: Number(piano.commandRevision),
      lastHandledRevision: Number(piano.lastHandledRevision),
    }, reported);
    await transaction.update(pianos).set({
      online: reported.online,
      firmwareVersion: reported.firmwareVersion,
      firmwareProfileId: reported.profileId,
      firmwareProfileVersion: reported.profileVersion,
      lastSeenAt: now,
      lastReportedAt: reportedAt,
      updatedAt: now,
      ...(plan.currentOrNewer ? {
        lastAppliedRevision: Math.max(reported.lastAppliedRevision, Number(piano.lastAppliedRevision)),
        lastHandledRevision: Math.max(reported.lastHandledRevision, Number(piano.lastHandledRevision)),
      } : {}),
      ...(plan.mayApplyRuntime ? {
        state: reported.state,
        positionMs: reported.positionMs,
        durationMs: reported.durationMs,
        errorCode: reported.error?.code ?? null,
        errorMessage: reported.error?.message ?? null,
      } : {}),
    }).where(eq(pianos.id, reported.pianoId));

    if (plan.mayRecoverOrphanedSession && piano.activeSessionId) {
      const [latestCommand] = await transaction.select({
        id: commands.id,
        type: commands.type,
        revision: commands.revision,
        sessionId: commands.sessionId,
      }).from(commands).where(and(
        eq(commands.pianoId, reported.pianoId),
        eq(commands.revision, piano.commandRevision),
      )).limit(1);
      const confirmedStop = latestCommand?.type === "stop" &&
        latestCommand.sessionId === piano.activeSessionId &&
        reported.lastAppliedRevision >= Number(latestCommand.revision);
      await transaction.update(playbackSessions).set({
        state: confirmedStop ? "stopped" : "failed",
        endedAt: sql`COALESCE(${playbackSessions.endedAt}, NOW())`,
        ...(!confirmedStop ? { errorMessage: "Device restarted without reporting a final session outcome" } : {}),
      }).where(and(
        eq(playbackSessions.id, piano.activeSessionId),
        eq(playbackSessions.pianoId, reported.pianoId),
        notInArray(playbackSessions.state, terminalSessionStates),
      ));
      await transaction.update(pianos).set({
        state: "idle",
        activeSessionId: null,
        positionMs: reported.positionMs,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      }).where(and(eq(pianos.id, reported.pianoId), eq(pianos.activeSessionId, piano.activeSessionId)));
      if (confirmedStop && latestCommand) {
        await transaction.update(commands).set({
          status: "acknowledged",
          acknowledgedAt: now,
          errorMessage: null,
        }).where(and(
          eq(commands.id, latestCommand.id),
          inArray(commands.status, mutableCommandStates),
        ));
      }
    }

    if (plan.activeSessionMatches && reported.sessionId) {
      if (reported.sessionOutcome) {
        await transaction.update(playbackSessions).set({
          state: reported.sessionOutcome,
          positionMs: reported.positionMs,
          endedAt: sql`COALESCE(${playbackSessions.endedAt}, NOW())`,
          ...(reported.sessionOutcome === "failed" ? { errorMessage: reported.error?.message ?? "Device playback failed" } : {}),
        }).where(and(
          eq(playbackSessions.id, reported.sessionId),
          eq(playbackSessions.pianoId, reported.pianoId),
          notInArray(playbackSessions.state, terminalSessionStates),
        ));
        if (plan.mayClearActiveSession) {
          await transaction.update(pianos).set({ state: "idle", activeSessionId: null, positionMs: reported.positionMs, updatedAt: now })
            .where(and(eq(pianos.id, reported.pianoId), eq(pianos.activeSessionId, reported.sessionId)));
        }
      } else {
        const sessionState = activeSessionState(reported.state);
        if (sessionState) {
          await transaction.update(playbackSessions).set({
            state: sessionState,
            positionMs: reported.positionMs,
            ...(reported.state === "playing" ? { startedAt: sql`COALESCE(${playbackSessions.startedAt}, NOW())` } : {}),
          }).where(and(
            eq(playbackSessions.id, reported.sessionId),
            eq(playbackSessions.pianoId, reported.pianoId),
            notInArray(playbackSessions.state, terminalSessionStates),
          ));
        }
      }
    }

    if (!reported.acknowledgement) return;
    const acknowledgement = reported.acknowledgement;
    await transaction.update(commands).set({
      status: acknowledgement.result === "accepted" ? "acknowledged" : "rejected",
      acknowledgedAt: now,
      errorMessage: acknowledgement.error?.message ?? null,
    }).where(and(
      eq(commands.id, acknowledgement.commandId),
      eq(commands.pianoId, reported.pianoId),
      eq(commands.revision, acknowledgement.revision),
      inArray(commands.status, mutableCommandStates),
    ));

    if (acknowledgement.result !== "rejected") return;
    const [rejected] = await transaction.select({ type: commands.type, sessionId: commands.sessionId }).from(commands)
      .where(and(eq(commands.id, acknowledgement.commandId), eq(commands.pianoId, reported.pianoId))).limit(1);
    if (rejected?.type !== "play" || !rejected.sessionId || piano.activeSessionId !== rejected.sessionId) return;
    await transaction.update(playbackSessions).set({ state: "failed", endedAt: now, errorMessage: acknowledgement.error?.message ?? "Device rejected Play" })
      .where(and(eq(playbackSessions.id, rejected.sessionId), notInArray(playbackSessions.state, terminalSessionStates)));
    await transaction.update(pianos).set({ state: "idle", activeSessionId: null, updatedAt: now })
      .where(and(eq(pianos.id, reported.pianoId), eq(pianos.activeSessionId, rejected.sessionId)));
  });
  return new Response(null, { status: 204 });
};

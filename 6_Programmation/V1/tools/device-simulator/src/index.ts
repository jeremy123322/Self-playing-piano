import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import mqtt from "mqtt";
import {
  LEGACY_V1_PROFILE,
  artifactProfileCompatible,
  parseDesiredCommand,
  type CommandAcknowledgement,
  type DesiredCommand,
  type PianoState,
  type ReportedState,
  type SessionOutcome,
} from "@spp/contracts";
import { decodeArtifact } from "@spp/midi";
import { completedPosition, guardCommand } from "./command-guard";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

interface PersistedState {
  lastAppliedRevision: number;
  lastHandledRevision: number;
}

const pianoId = required("PIANO_ID");
const mqttUrl = required("MQTT_URL");
const apiBaseUrl = required("API_BASE_URL");
const deviceToken = required("PIANO_DEVICE_TOKEN");
const stateFile = process.env.SIMULATOR_STATE_FILE ?? ".device-simulator-state.json";
const prefix = process.env.MQTT_TOPIC_PREFIX ?? "pianos";
const desiredTopic = `${prefix}/${pianoId}/v1/desired`;
const reportedTopic = `${prefix}/${pianoId}/v1/reported`;
const persisted = await readFile(stateFile, "utf8").then((value) => JSON.parse(value) as PersistedState).catch(() => ({ lastAppliedRevision: 0, lastHandledRevision: 0 }));

let state: PianoState = "idle";
let sessionId: string | undefined;
let songId: string | undefined;
let positionMs = 0;
let durationMs = 0;
let startedAt = Date.now();
let lastAppliedRevision = persisted.lastAppliedRevision;
let lastHandledRevision = persisted.lastHandledRevision;
let acknowledgement: CommandAcknowledgement | undefined;
let sessionOutcome: SessionOutcome | undefined;
const durableReports: string[] = [];
let flushingDurableReports = false;
let commandChain = Promise.resolve();

const currentPosition = () => state === "playing"
  ? Math.min(durationMs, positionMs + Date.now() - startedAt)
  : positionMs;

const snapshot = (online = true): ReportedState => ({
  pianoId,
  state: online ? state : "offline",
  online,
  ...(sessionId ? { sessionId } : {}),
  ...(songId ? { songId } : {}),
  positionMs: currentPosition(),
  durationMs,
  firmwareVersion: "simulator-2.4.1",
  profileId: LEGACY_V1_PROFILE.id,
  profileVersion: LEGACY_V1_PROFILE.version,
  lastAppliedRevision,
  lastHandledRevision,
  ...(acknowledgement ? { acknowledgement } : {}),
  ...(sessionOutcome ? { sessionOutcome } : {}),
  statusDelivery: {
    state: durableReports.length >= 28 ? "backpressure" : durableReports.length > 0 ? "retrying" : "healthy",
    pendingReports: durableReports.length,
  },
  reportedAt: new Date().toISOString(),
});

const persist = () => writeFile(stateFile, JSON.stringify({ lastAppliedRevision, lastHandledRevision } satisfies PersistedState));

const client = mqtt.connect(mqttUrl, {
  clientId: pianoId,
  clean: false,
  ...(process.env.MQTT_DEVICE_USERNAME ? { username: process.env.MQTT_DEVICE_USERNAME } : {}),
  ...(process.env.MQTT_DEVICE_PASSWORD ? { password: process.env.MQTT_DEVICE_PASSWORD } : {}),
  will: { topic: reportedTopic, payload: JSON.stringify(snapshot(false)), qos: 1, retain: true },
});

const flushDurableReports = async () => {
  if (flushingDurableReports) return;
  flushingDurableReports = true;
  try {
    while (durableReports.length > 0) {
      const payload = durableReports[0];
      if (!payload) return;
      const response = await fetch(`${apiBaseUrl}/api/device/status`, {
        method: "POST",
        headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
        body: payload,
      });
      if (!response.ok) throw new Error(`Status endpoint returned HTTP ${response.status}`);
      durableReports.shift();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Durable status delivery failed");
  } finally {
    flushingDurableReports = false;
  }
};

const report = async () => {
  const reportSnapshot = snapshot();
  const payload = JSON.stringify(durableReports.length < 32
    ? {
        ...reportSnapshot,
        statusDelivery: {
          state: durableReports.length >= 27 ? "backpressure" : "retrying",
          pendingReports: durableReports.length + 1,
        },
      }
    : reportSnapshot);
  await client.publishAsync(reportedTopic, payload, { qos: 1, retain: true });
  if (durableReports.length < 32) durableReports.push(payload);
  await flushDurableReports();
  await client.publishAsync(reportedTopic, JSON.stringify(snapshot()), { qos: 1, retain: true });
};

const reject = async (command: DesiredCommand, code: string, message: string) => {
  lastHandledRevision = command.revision;
  acknowledgement = { commandId: command.commandId, revision: command.revision, result: "rejected", error: { code, message } };
  await persist();
  await report();
};

const accept = async (command: DesiredCommand) => {
  lastHandledRevision = command.revision;
  lastAppliedRevision = command.revision;
  acknowledgement = { commandId: command.commandId, revision: command.revision, result: "accepted" };
  await persist();
};

const apply = async (command: DesiredCommand) => {
  const guard = guardCommand(lastHandledRevision, command.revision, command.expiresAtEpochSeconds);
  if (guard === "duplicate") return;
  if (guard === "expired") {
    await reject(command, "command_expired", "The retained command has expired");
    return;
  }
  if (!["play", "stop", "emergency_recover", "restart_controller", "enter_provisioning"].includes(command.type) &&
      command.sessionId !== sessionId) {
    await reject(command, "session_mismatch", "The active session does not match");
    return;
  }

  if (command.type === "play") {
    if (state !== "idle") {
      await reject(command, "piano_busy", "The piano is not idle");
      return;
    }
    if (command.profileId !== LEGACY_V1_PROFILE.id ||
        !artifactProfileCompatible(command.artifactVersion ?? 0, command.profileVersion ?? 0)) {
      await reject(command, "profile_mismatch", "The command artifact is incompatible with this simulator profile");
      return;
    }
    await accept(command);
    state = "preparing";
    sessionId = command.sessionId;
    songId = command.songId;
    sessionOutcome = undefined;
    await report();
    const response = await fetch(`${apiBaseUrl}/api/device/sessions/${command.sessionId}/artifact`, { headers: { authorization: `Bearer ${deviceToken}` } });
    if (!response.ok) {
      state = "error";
      sessionOutcome = "failed";
      await report();
      return;
    }
    const artifactBytes = new Uint8Array(await response.arrayBuffer());
    const actualSha256 = createHash("sha256").update(artifactBytes).digest("hex");
    if (artifactBytes.byteLength !== command.artifactBytes || actualSha256 !== command.artifactSha256) {
      state = "error";
      sessionOutcome = "failed";
      await report();
      return;
    }
    let artifact;
    try {
      artifact = decodeArtifact(artifactBytes);
    } catch {
      state = "error";
      sessionOutcome = "failed";
      await report();
      return;
    }
    if (artifact.version !== command.artifactVersion || artifact.profileVersion !== command.profileVersion) {
      state = "error";
      sessionOutcome = "failed";
      await report();
      return;
    }
    durationMs = artifact.durationMs;
    positionMs = 0;
    startedAt = Date.now();
    state = "playing";
  } else if (command.type === "pause" && state === "playing") {
    positionMs = currentPosition();
    state = "paused";
    await accept(command);
  } else if (command.type === "resume" && state === "paused") {
    startedAt = Date.now();
    state = "playing";
    await accept(command);
  } else if (command.type === "restart" && (state === "playing" || state === "paused")) {
    positionMs = 0;
    startedAt = Date.now();
    state = "playing";
    await accept(command);
  } else if (command.type === "stop") {
    if (!sessionId) sessionId = command.sessionId;
    positionMs = currentPosition();
    state = "idle";
    sessionOutcome = "stopped";
    await accept(command);
  } else if (command.type === "emergency_recover" || command.type === "restart_controller") {
    sessionId = command.sessionId;
    songId = command.songId;
    positionMs = currentPosition();
    state = "idle";
    sessionOutcome = "stopped";
    await accept(command);
  } else if (command.type === "enter_provisioning" && state === "idle") {
    await accept(command);
    state = "provisioning";
  } else {
    await reject(command, "invalid_state", "The command is not valid in the current state");
    return;
  }
  await report();
};

client.on("connect", async () => {
  await client.subscribeAsync(desiredTopic, { qos: 1 });
  await report();
});
client.on("message", (_topic, payload) => {
  let value: unknown;
  try {
    value = JSON.parse(payload.toString());
  } catch {
    return;
  }
  const command = parseDesiredCommand(value);
  if (!command || command.pianoId !== pianoId || durableReports.length >= 28) return;
  commandChain = commandChain
    .then(() => apply(command))
    .catch((error) => console.error(error instanceof Error ? error.message : "Command handling failed"));
});
setInterval(() => {
  if (state === "playing" && currentPosition() >= durationMs) {
    positionMs = completedPosition(durationMs);
    state = "idle";
    sessionOutcome = "completed";
  }
  void report();
}, 1000);
setInterval(() => void flushDurableReports(), 2_000);

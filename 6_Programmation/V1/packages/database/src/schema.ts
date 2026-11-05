import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  MAX_COMMAND_REVISION,
  MAX_TIMELINE_MS,
  commandTypes,
  pianoStates,
  type DesiredCommand,
  type PianoState,
} from "@spp/contracts";

export const pianoStateEnum = pgEnum("piano_state", pianoStates);
export const commandTypeEnum = pgEnum("command_type", commandTypes);
export const songStatusEnum = pgEnum("song_status", ["processing", "ready", "invalid"]);
export const sessionStateEnum = pgEnum("session_state", ["dispatching", "preparing", "playing", "paused", "completed", "stopped", "failed"]);
export const commandStatusEnum = pgEnum("command_status", ["pending", "published", "acknowledged", "rejected", "dispatch_failed", "dispatch_uncertain"]);

export const pianoProfiles = pgTable("piano_profiles", {
  id: text("id").primaryKey(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  midiStart: integer("midi_start").notNull(),
  keyCount: integer("key_count").notNull(),
  maxPolyphony: integer("max_polyphony").notNull(),
  retriggerGapMs: integer("retrigger_gap_ms").notNull(),
  leadInMs: integer("lead_in_ms").notNull(),
  activationLeadMs: integer("activation_lead_ms").notNull(),
  keyMap: jsonb("key_map").$type<number[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("piano_profiles_version_idx").on(table.version)]);

export const pianos = pgTable("pianos", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  profileId: text("profile_id").references(() => pianoProfiles.id).notNull(),
  state: pianoStateEnum("state").default("offline").notNull(),
  online: boolean("online").default(false).notNull(),
  positionMs: integer("position_ms").default(0).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  activeSessionId: uuid("active_session_id"),
  commandRevision: bigint("command_revision", { mode: "number" }).default(0).notNull(),
  lastAppliedRevision: bigint("last_applied_revision", { mode: "number" }).default(0).notNull(),
  lastHandledRevision: bigint("last_handled_revision", { mode: "number" }).default(0).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastReportedAt: timestamp("last_reported_at", { withTimezone: true }),
  firmwareVersion: text("firmware_version"),
  firmwareProfileId: text("firmware_profile_id"),
  firmwareProfileVersion: integer("firmware_profile_version"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  deviceTokenHash: text("device_token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("pianos_position_ms_range", sql`${table.positionMs} BETWEEN 0 AND ${MAX_TIMELINE_MS}`),
  check("pianos_duration_ms_range", sql`${table.durationMs} BETWEEN 0 AND ${MAX_TIMELINE_MS}`),
  check("pianos_command_revision_range", sql`${table.commandRevision} BETWEEN 0 AND ${MAX_COMMAND_REVISION}`),
  check("pianos_last_applied_revision_range", sql`${table.lastAppliedRevision} BETWEEN 0 AND ${MAX_COMMAND_REVISION}`),
  check("pianos_last_handled_revision_range", sql`${table.lastHandledRevision} BETWEEN 0 AND ${MAX_COMMAND_REVISION}`),
  check("pianos_firmware_profile_version_range", sql`${table.firmwareProfileVersion} IS NULL OR ${table.firmwareProfileVersion} BETWEEN 1 AND 255`),
]);

export const songs = pgTable("songs", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  artist: text("artist"),
  status: songStatusEnum("status").default("processing").notNull(),
  originalObjectKey: text("original_object_key").notNull(),
  originalSha256: text("original_sha256").notNull(),
  originalBytes: integer("original_bytes").notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  noteCount: integer("note_count").default(0).notNull(),
  warnings: jsonb("warnings").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  errorMessage: text("error_message"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("songs_source_hash_idx").on(table.originalSha256),
  index("songs_title_idx").on(table.title),
  check("songs_duration_ms_range", sql`${table.durationMs} BETWEEN 0 AND ${MAX_TIMELINE_MS}`),
]);

export const artifacts = pgTable("artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  songId: uuid("song_id").references(() => songs.id, { onDelete: "cascade" }).notNull(),
  profileId: text("profile_id").references(() => pianoProfiles.id).notNull(),
  profileVersion: integer("profile_version").notNull(),
  formatVersion: integer("format_version").notNull(),
  processorVersion: integer("processor_version").notNull(),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  noteCount: integer("note_count").notNull(),
  durationMs: integer("duration_ms").notNull(),
  isCurrent: boolean("is_current").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("artifacts_song_profile_version_idx").on(table.songId, table.profileId, table.processorVersion),
  uniqueIndex("artifacts_current_song_profile_idx").on(table.songId, table.profileId).where(sql`${table.isCurrent} = true`),
  check("artifacts_duration_ms_range", sql`${table.durationMs} BETWEEN 0 AND ${MAX_TIMELINE_MS}`),
  check("artifacts_profile_version_range", sql`${table.profileVersion} BETWEEN 1 AND 255`),
]);

export const playbackSessions = pgTable("playback_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  pianoId: uuid("piano_id").references(() => pianos.id).notNull(),
  songId: uuid("song_id").references(() => songs.id).notNull(),
  artifactId: uuid("artifact_id").references(() => artifacts.id).notNull(),
  state: sessionStateEnum("state").default("dispatching").notNull(),
  positionMs: integer("position_ms").default(0).notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  errorMessage: text("error_message"),
}, (table) => [
  check("playback_sessions_position_ms_range", sql`${table.positionMs} BETWEEN 0 AND ${MAX_TIMELINE_MS}`),
]);

export const commands = pgTable("commands", {
  id: uuid("id").defaultRandom().primaryKey(),
  pianoId: uuid("piano_id").references(() => pianos.id).notNull(),
  sessionId: uuid("session_id").references(() => playbackSessions.id),
  type: commandTypeEnum("type").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  status: commandStatusEnum("status").default("pending").notNull(),
  payload: jsonb("payload").$type<DesiredCommand>().notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("commands_piano_revision_idx").on(table.pianoId, table.revision),
  check("commands_revision_range", sql`${table.revision} BETWEEN 1 AND ${MAX_COMMAND_REVISION}`),
]);

export type PianoRow = typeof pianos.$inferSelect;
export type NewPianoState = Exclude<PianoState, "offline"> | "offline";

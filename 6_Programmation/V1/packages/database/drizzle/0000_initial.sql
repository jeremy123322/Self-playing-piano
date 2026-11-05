CREATE TYPE "piano_state" AS ENUM ('booting','provisioning','connecting','idle','preparing','ready','playing','paused','stopping','error','offline');
CREATE TYPE "command_type" AS ENUM ('play','pause','resume','restart','stop','enter_provisioning');
CREATE TYPE "song_status" AS ENUM ('processing','ready','invalid');
CREATE TYPE "session_state" AS ENUM ('dispatching','preparing','playing','paused','completed','stopped','failed');
CREATE TYPE "command_status" AS ENUM ('pending','published','acknowledged','rejected','dispatch_failed','dispatch_uncertain');

CREATE TABLE "piano_profiles" (
  "id" text PRIMARY KEY,
  "version" integer NOT NULL UNIQUE,
  "name" text NOT NULL,
  "midi_start" integer NOT NULL,
  "key_count" integer NOT NULL,
  "max_polyphony" integer NOT NULL,
  "retrigger_gap_ms" integer NOT NULL,
  "key_map" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "pianos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "profile_id" text NOT NULL REFERENCES "piano_profiles"("id"),
  "state" piano_state NOT NULL DEFAULT 'offline',
  "online" boolean NOT NULL DEFAULT false,
  "position_ms" integer NOT NULL DEFAULT 0,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "active_session_id" uuid,
  "command_revision" bigint NOT NULL DEFAULT 0,
  "last_applied_revision" bigint NOT NULL DEFAULT 0,
  "last_handled_revision" bigint NOT NULL DEFAULT 0,
  "last_seen_at" timestamptz,
  "firmware_version" text,
  "device_token_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "songs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "artist" text,
  "status" song_status NOT NULL DEFAULT 'processing',
  "original_object_key" text NOT NULL,
  "original_sha256" text NOT NULL UNIQUE,
  "original_bytes" integer NOT NULL,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "note_count" integer NOT NULL DEFAULT 0,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error_message" text,
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "songs_title_idx" ON "songs"("title");
CREATE TABLE "artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "song_id" uuid NOT NULL REFERENCES "songs"("id") ON DELETE CASCADE,
  "profile_id" text NOT NULL REFERENCES "piano_profiles"("id"),
  "format_version" integer NOT NULL,
  "processor_version" integer NOT NULL,
  "object_key" text NOT NULL,
  "sha256" text NOT NULL,
  "byte_size" integer NOT NULL,
  "note_count" integer NOT NULL,
  "duration_ms" integer NOT NULL,
  "is_current" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("song_id", "profile_id", "processor_version")
);
CREATE UNIQUE INDEX "artifacts_current_song_profile_idx" ON "artifacts"("song_id", "profile_id") WHERE "is_current" = true;
CREATE TABLE "playback_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "piano_id" uuid NOT NULL REFERENCES "pianos"("id"),
  "song_id" uuid NOT NULL REFERENCES "songs"("id"),
  "artifact_id" uuid NOT NULL REFERENCES "artifacts"("id"),
  "state" session_state NOT NULL DEFAULT 'dispatching',
  "position_ms" integer NOT NULL DEFAULT 0,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "error_message" text
);
ALTER TABLE "pianos" ADD CONSTRAINT "pianos_active_session_id_playback_sessions_id_fk" FOREIGN KEY ("active_session_id") REFERENCES "playback_sessions"("id");
CREATE TABLE "commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "piano_id" uuid NOT NULL REFERENCES "pianos"("id"),
  "session_id" uuid REFERENCES "playback_sessions"("id"),
  "type" command_type NOT NULL,
  "revision" bigint NOT NULL,
  "status" command_status NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  "acknowledged_at" timestamptz,
  UNIQUE ("piano_id", "revision")
);

ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'dispatch_uncertain';

ALTER TABLE "pianos" ADD COLUMN IF NOT EXISTS "last_handled_revision" bigint NOT NULL DEFAULT 0;
UPDATE "pianos" SET "last_handled_revision" = "last_applied_revision" WHERE "last_handled_revision" < "last_applied_revision";

ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "is_current" boolean NOT NULL DEFAULT true;
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "song_id", "profile_id"
    ORDER BY "processor_version" DESC, "created_at" DESC, "id" DESC
  ) AS position
  FROM "artifacts"
)
UPDATE "artifacts"
SET "is_current" = ranked.position = 1
FROM ranked
WHERE "artifacts"."id" = ranked."id";
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_current_song_profile_idx"
  ON "artifacts"("song_id", "profile_id") WHERE "is_current" = true;

ALTER TABLE "commands" ADD COLUMN IF NOT EXISTS "payload" jsonb;
UPDATE "commands" SET "payload" = jsonb_build_object(
  'commandId', "id",
  'pianoId', "piano_id",
  'sessionId', COALESCE("session_id"::text, ''),
  'type', "type",
  'revision', "revision",
  'expiresAt', "created_at"
) WHERE "payload" IS NULL;
ALTER TABLE "commands" ALTER COLUMN "payload" SET NOT NULL;
ALTER TABLE "commands" ADD COLUMN IF NOT EXISTS "published_at" timestamptz;

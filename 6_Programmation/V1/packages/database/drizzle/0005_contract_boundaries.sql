ALTER TABLE "pianos" ADD COLUMN IF NOT EXISTS "firmware_profile_id" text;
ALTER TABLE "pianos" ADD COLUMN IF NOT EXISTS "firmware_profile_version" integer;
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "profile_version" integer;
UPDATE "artifacts" SET "profile_version" = CASE WHEN "format_version" = 1 THEN 1 ELSE 2 END WHERE "profile_version" IS NULL;
ALTER TABLE "artifacts" ALTER COLUMN "profile_version" SET NOT NULL;

ALTER TABLE "pianos" ADD CONSTRAINT "pianos_position_ms_range" CHECK ("position_ms" BETWEEN 0 AND 2147483647);
ALTER TABLE "pianos" ADD CONSTRAINT "pianos_duration_ms_range" CHECK ("duration_ms" BETWEEN 0 AND 2147483647);
ALTER TABLE "pianos" ADD CONSTRAINT "pianos_command_revision_range" CHECK ("command_revision" BETWEEN 0 AND 4294967295);
ALTER TABLE "pianos" ADD CONSTRAINT "pianos_last_applied_revision_range" CHECK ("last_applied_revision" BETWEEN 0 AND 4294967295);
ALTER TABLE "pianos" ADD CONSTRAINT "pianos_last_handled_revision_range" CHECK ("last_handled_revision" BETWEEN 0 AND 4294967295);
ALTER TABLE "pianos" ADD CONSTRAINT "pianos_firmware_profile_version_range" CHECK ("firmware_profile_version" IS NULL OR "firmware_profile_version" BETWEEN 1 AND 255);
ALTER TABLE "songs" ADD CONSTRAINT "songs_duration_ms_range" CHECK ("duration_ms" BETWEEN 0 AND 2147483647);
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_duration_ms_range" CHECK ("duration_ms" BETWEEN 0 AND 2147483647);
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_profile_version_range" CHECK ("profile_version" BETWEEN 1 AND 255);
ALTER TABLE "playback_sessions" ADD CONSTRAINT "playback_sessions_position_ms_range" CHECK ("position_ms" BETWEEN 0 AND 2147483647);
ALTER TABLE "commands" ADD CONSTRAINT "commands_revision_range" CHECK ("revision" BETWEEN 1 AND 4294967295);

ALTER TABLE "piano_profiles" ADD COLUMN "lead_in_ms" integer DEFAULT 5000 NOT NULL;
ALTER TABLE "piano_profiles" ADD COLUMN "activation_lead_ms" integer DEFAULT 20 NOT NULL;
ALTER TABLE "piano_profiles" ALTER COLUMN "lead_in_ms" DROP DEFAULT;
ALTER TABLE "piano_profiles" ALTER COLUMN "activation_lead_ms" DROP DEFAULT;

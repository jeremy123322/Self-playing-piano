import { createHash } from "node:crypto";
import { LEGACY_V1_PROFILE } from "@spp/contracts";
import { createDatabase } from "./client.js";
import { pianoProfiles, pianos } from "./schema.js";

const deviceToken = process.env.PIANO_DEVICE_TOKEN;
if (!deviceToken) throw new Error("PIANO_DEVICE_TOKEN is required");

const { db, close } = createDatabase();

try {
  await db.insert(pianoProfiles).values({
    id: LEGACY_V1_PROFILE.id,
    version: LEGACY_V1_PROFILE.version,
    name: LEGACY_V1_PROFILE.name,
    midiStart: LEGACY_V1_PROFILE.midiStart,
    keyCount: LEGACY_V1_PROFILE.keyCount,
    maxPolyphony: LEGACY_V1_PROFILE.maxPolyphony,
    retriggerGapMs: LEGACY_V1_PROFILE.retriggerGapMs,
    leadInMs: LEGACY_V1_PROFILE.leadInMs,
    activationLeadMs: LEGACY_V1_PROFILE.activationLeadMs,
    keyMap: [...LEGACY_V1_PROFILE.keyMap],
  }).onConflictDoUpdate({
    target: pianoProfiles.id,
    set: {
      version: LEGACY_V1_PROFILE.version,
      name: LEGACY_V1_PROFILE.name,
      maxPolyphony: LEGACY_V1_PROFILE.maxPolyphony,
      retriggerGapMs: LEGACY_V1_PROFILE.retriggerGapMs,
      leadInMs: LEGACY_V1_PROFILE.leadInMs,
      activationLeadMs: LEGACY_V1_PROFILE.activationLeadMs,
      keyMap: [...LEGACY_V1_PROFILE.keyMap],
    },
  });

  const [piano] = await db.insert(pianos).values({
    slug: process.env.PIANO_SLUG ?? "house-piano",
    name: process.env.PIANO_NAME ?? "House Piano",
    profileId: LEGACY_V1_PROFILE.id,
    deviceTokenHash: createHash("sha256").update(deviceToken).digest("hex"),
  }).onConflictDoUpdate({
    target: pianos.slug,
    set: {
      name: process.env.PIANO_NAME ?? "House Piano",
      profileId: LEGACY_V1_PROFILE.id,
      deviceTokenHash: createHash("sha256").update(deviceToken).digest("hex"),
      updatedAt: new Date(),
    },
  }).returning({ id: pianos.id, slug: pianos.slug });

  process.stdout.write(`${JSON.stringify(piano)}\n`);
} finally {
  await close();
}

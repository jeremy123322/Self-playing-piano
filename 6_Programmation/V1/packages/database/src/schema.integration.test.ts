import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl && new URL(testUrl).pathname.endsWith("/spp_test") ? describe : describe.skip;
const client = testUrl ? postgres(testUrl, { max: 4, prepare: false }) : undefined;

const profileId = "legacy-v1";
const pianoId = "00000000-0000-0000-0000-000000000001";
const songId = "00000000-0000-0000-0000-000000000002";
const artifactId = "00000000-0000-0000-0000-000000000003";
const firstSessionId = "00000000-0000-0000-0000-000000000004";
const secondSessionId = "00000000-0000-0000-0000-000000000005";

integration("database reliability invariants", () => {
  beforeAll(async () => {
    if (!client) return;
    await client`DROP SCHEMA public CASCADE`;
    await client`CREATE SCHEMA public`;
    for (const migration of [
      "0000_initial.sql",
      "0001_reliability.sql",
      "0002_piano_errors.sql",
      "0003_recovery_commands.sql",
      "0004_artifact_timing.sql",
      "0005_contract_boundaries.sql",
      "0006_status_ordering.sql",
    ]) {
      const path = fileURLToPath(new URL(`../drizzle/${migration}`, import.meta.url));
      await client.unsafe(await readFile(path, "utf8"));
    }
    await client`INSERT INTO piano_profiles (id, version, name, midi_start, key_count, max_polyphony, retrigger_gap_ms, lead_in_ms, activation_lead_ms, key_map)
      VALUES (${profileId}, 2, 'Test', 21, 88, 10, 100, 5000, 20, '[]'::jsonb)`;
    await client`INSERT INTO pianos (id, slug, name, profile_id, state, online, device_token_hash)
      VALUES (${pianoId}, 'test', 'Test piano', ${profileId}, 'idle', true, 'hash')`;
    await client`INSERT INTO songs (id, title, status, original_object_key, original_sha256, original_bytes)
      VALUES (${songId}, 'Test song', 'ready', 'original.mid', 'source-hash', 10)`;
    await client`INSERT INTO artifacts (id, song_id, profile_id, profile_version, format_version, processor_version, object_key, sha256, byte_size, note_count, duration_ms)
      VALUES (${artifactId}, ${songId}, ${profileId}, 1, 1, 1, 'v1.spp', 'artifact-hash', 16, 0, 0)`;
    await client`INSERT INTO playback_sessions (id, piano_id, song_id, artifact_id) VALUES
      (${firstSessionId}, ${pianoId}, ${songId}, ${artifactId}),
      (${secondSessionId}, ${pianoId}, ${songId}, ${artifactId})`;
  });

  afterAll(async () => client?.end());

  it("allows exactly one concurrent session reservation", async () => {
    if (!client) return;
    const reserve = (sessionId: string) => client.begin(async (transaction) => {
      const [piano] = await transaction<{ active_session_id: string | null }[]>`
        SELECT active_session_id FROM pianos WHERE id = ${pianoId} FOR UPDATE`;
      if (piano?.active_session_id) return false;
      await transaction`UPDATE pianos SET active_session_id = ${sessionId}, state = 'preparing' WHERE id = ${pianoId}`;
      return true;
    });
    const results = await Promise.all([reserve(firstSessionId), reserve(secondSessionId)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("keeps a session on its immutable artifact after reprocessing and archival", async () => {
    if (!client) return;
    const nextArtifactId = "00000000-0000-0000-0000-000000000006";
    await client.begin(async (transaction) => {
      await transaction`UPDATE artifacts SET is_current = false WHERE id = ${artifactId}`;
      await transaction`INSERT INTO artifacts (id, song_id, profile_id, profile_version, format_version, processor_version, object_key, sha256, byte_size, note_count, duration_ms)
        VALUES (${nextArtifactId}, ${songId}, ${profileId}, 1, 1, 2, 'v2.spp', 'artifact-hash-2', 16, 0, 0)`;
      await transaction`UPDATE songs SET archived_at = now() WHERE id = ${songId}`;
    });
    const [history] = await client<{ object_key: string }[]>`
      SELECT artifacts.object_key FROM playback_sessions
      JOIN artifacts ON artifacts.id = playback_sessions.artifact_id
      WHERE playback_sessions.id = ${firstSessionId}`;
    const [current] = await client<{ object_key: string }[]>`
      SELECT object_key FROM artifacts WHERE song_id = ${songId} AND profile_id = ${profileId} AND is_current = true`;
    expect(history?.object_key).toBe("v1.spp");
    expect(current?.object_key).toBe("v2.spp");
  });

  it("rejects values that cannot cross the database and firmware boundary", async () => {
    if (!client) return;
    await expect(client`UPDATE pianos SET command_revision = 4294967296 WHERE id = ${pianoId}`)
      .rejects.toThrow();
    await expect(client`UPDATE pianos SET duration_ms = 2147483648 WHERE id = ${pianoId}`)
      .rejects.toThrow();
  });
});

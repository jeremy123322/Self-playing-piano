import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const migrationDirectory = fileURLToPath(new URL("../drizzle", import.meta.url));
const client = postgres(url, { prepare: false, max: 1, onnotice: () => undefined });

try {
  await client`CREATE TABLE IF NOT EXISTS spp_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  await client`ALTER TABLE spp_migrations ADD COLUMN IF NOT EXISTS checksum text`;
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const migrationFile of migrationFiles) {
    const migrationId = migrationFile.replace(/\.sql$/, "");
    const migration = await readFile(`${migrationDirectory}/${migrationFile}`, "utf8");
    const checksum = createHash("sha256").update(migration).digest("hex");
    const [applied] = await client<{ checksum: string | null }[]>`
      SELECT checksum FROM spp_migrations WHERE id = ${migrationId}`;
    if (applied) {
      if (applied.checksum && applied.checksum !== checksum) {
        throw new Error(`Applied migration ${migrationId} has been modified`);
      }
      if (!applied.checksum) {
        await client`UPDATE spp_migrations SET checksum = ${checksum} WHERE id = ${migrationId}`;
      }
      continue;
    }
    await client.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO spp_migrations (id, checksum) VALUES (${migrationId}, ${checksum})`;
    });
    process.stdout.write(`Applied database migration ${migrationId}.\n`);
  }
  process.stdout.write("Database migrations are up to date.\n");
} finally {
  await client.end();
}

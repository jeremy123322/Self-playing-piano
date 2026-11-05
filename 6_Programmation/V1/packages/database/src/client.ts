import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export const createDatabase = (url = process.env.DATABASE_URL) => {
  if (!url) throw new Error("DATABASE_URL is required");
  const client = postgres(url, { prepare: false, max: 5 });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
};

export type Database = ReturnType<typeof createDatabase>["db"];

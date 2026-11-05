import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { pianos } from "@spp/database";
import { database } from "./services";

const hashToken = (token: string) => createHash("sha256").update(token).digest();

export const authenticateDevice = async (request: Request, pianoId: string) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const [piano] = await database().db.select().from(pianos).where(eq(pianos.id, pianoId)).limit(1);
  if (!piano) return null;
  const expected = Buffer.from(piano.deviceTokenHash, "hex");
  const actual = hashToken(token);
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) return null;
  return piano;
};

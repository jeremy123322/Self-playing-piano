import { and, ilike, isNull, or, desc } from "drizzle-orm";
import { songs } from "@spp/database";
import { database } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = async (request: Request) => {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  const where = and(isNull(songs.archivedAt), query ? or(ilike(songs.title, `%${query}%`), ilike(songs.artist, `%${query}%`)) : undefined);
  const rows = await database().db.select().from(songs).where(where).orderBy(desc(songs.createdAt)).limit(100);
  return Response.json({
    songs: rows.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      durationMs: song.durationMs,
      noteCount: song.noteCount,
      warnings: song.warnings,
      status: song.status,
      createdAt: song.createdAt.toISOString(),
    })),
  });
};

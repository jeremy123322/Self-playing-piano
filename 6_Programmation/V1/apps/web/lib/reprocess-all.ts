export interface ReprocessTarget {
  id: string;
  title: string;
}

export interface ReprocessFailure {
  title: string;
  message: string;
}

export interface ReprocessProgress {
  processed: number;
  total: number;
  currentTitle: string;
  failures: ReprocessFailure[];
}

interface ReprocessAllOptions {
  reprocess: (song: ReprocessTarget) => Promise<void>;
  onProgress?: (progress: ReprocessProgress) => void;
}

export const reprocessAllSongs = async (
  songs: ReprocessTarget[],
  { reprocess, onProgress }: ReprocessAllOptions,
) => {
  const failures: ReprocessFailure[] = [];
  let succeeded = 0;

  for (const [index, song] of songs.entries()) {
    try {
      await reprocess(song);
      succeeded += 1;
    } catch (error) {
      failures.push({
        title: song.title,
        message: error instanceof Error ? error.message : "Reprocessing failed",
      });
    }
    onProgress?.({
      processed: index + 1,
      total: songs.length,
      currentTitle: song.title,
      failures: [...failures],
    });
  }

  return { succeeded, failures };
};

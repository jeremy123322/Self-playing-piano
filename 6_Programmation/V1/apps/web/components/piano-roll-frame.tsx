"use client";

import { Loader2Icon } from "lucide-react";
import type { ArtifactNote } from "@spp/contracts";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { PianoRoll } from "@/components/piano-roll";

interface PianoRollFrameProps {
  notes: ArtifactNote[];
  positionMs: number;
  playing: boolean;
  loading?: boolean;
  className?: string;
}

/**
 * Wraps the falling-notes canvas with a blurred loading overlay so song switches
 * never flash an empty roll while the artifact is still downloading.
 */
export const PianoRollFrame = ({ notes, positionMs, playing, loading = false, className }: PianoRollFrameProps) => {
  const { t } = useLocale();

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <PianoRoll
        notes={notes}
        positionMs={positionMs}
        playing={playing && !loading}
        className={cn("transition-[filter,transform] duration-200", loading && "scale-[1.02] blur-sm")}
      />
      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-background/25 backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
          aria-label={t("preview.loading")}
        >
          <Loader2Icon className="size-7 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};

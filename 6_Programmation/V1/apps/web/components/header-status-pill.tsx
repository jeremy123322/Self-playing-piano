"use client";

import { cn } from "@/lib/utils";
import { usePianoSession } from "@/hooks/use-piano-session";
import { useLocale } from "@/hooks/use-locale";
import { STATE_DOT_CLASS, STATE_LABEL_KEY, STATE_TOOLTIP_KEY } from "@/lib/piano-state-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const HeaderStatusPill = () => {
  const { status } = usePianoSession();
  const { t } = useLocale();
  const state = status.online ? status.state : "offline";
  const tooltip = state === "error" && status.error?.message
    ? status.error.message
    : t(STATE_TOOLTIP_KEY[state]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium">
          <span className={cn("size-2 rounded-full", STATE_DOT_CLASS[state])} />
          <span className="tabular-nums">{t(STATE_LABEL_KEY[state])}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};

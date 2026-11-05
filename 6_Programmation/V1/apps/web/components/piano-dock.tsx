"use client";

import { useEffect, useState } from "react";
import { Maximize2Icon, PianoIcon, XIcon } from "lucide-react";
import type { SongSummary } from "@spp/contracts";
import type { ViewerRole } from "@/lib/authorization";
import { usePianoSession } from "@/hooks/use-piano-session";
import { useLocale } from "@/hooks/use-locale";
import { STATE_DOT_CLASS } from "@/lib/piano-state-display";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PianoControlPanel } from "@/components/piano-control-panel";

interface PianoDockProps {
  songs: SongSummary[];
  viewerRole: ViewerRole;
}

/** Closes the fullscreen falling-notes overlay on Escape, matching standard modal behavior. */
const useEscapeToClose = (active: boolean, onClose: () => void) => {
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);
};

/** A single icon button wrapped in a tooltip; used for every expand/close affordance around the dock. */
const ChromeIconButton = ({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
        {icon}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

const FullscreenOverlay = ({ songs, viewerRole, onClose }: PianoDockProps & { onClose: () => void }) => {
  const { t } = useLocale();
  useEscapeToClose(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between pb-4">
        <p className="text-sm font-medium text-muted-foreground">{t("panel.title")}</p>
        <ChromeIconButton icon={<XIcon className="size-4" />} label={t("panel.exitFullscreen")} onClick={onClose} />
      </div>
      <PianoControlPanel
        songs={songs}
        viewerRole={viewerRole}
        variant="fullscreen"
        className="mx-auto flex h-full w-full max-w-4xl flex-col"
      />
    </div>
  );
};

export const PianoDock = ({ songs, viewerRole }: PianoDockProps) => {
  const { status } = usePianoSession();
  const { t } = useLocale();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isFullscreen, setFullscreen] = useState(false);
  const dotClass = STATE_DOT_CLASS[status.online ? status.state : "offline"];

  const openFullscreen = () => {
    setFullscreen(true);
    setSheetOpen(false);
  };

  if (isFullscreen) {
    return <FullscreenOverlay songs={songs} viewerRole={viewerRole} onClose={() => setFullscreen(false)} />;
  }

  return (
    <>
      {/* Desktop: persistent sidebar, always visible alongside the library */}
      <aside className="hidden lg:sticky lg:top-[calc(4rem+1.5rem)] lg:block lg:h-fit lg:w-[380px] lg:shrink-0">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">{t("panel.title")}</p>
            <ChromeIconButton icon={<Maximize2Icon className="size-4" />} label={t("panel.expand")} onClick={openFullscreen} />
          </div>
          <PianoControlPanel songs={songs} viewerRole={viewerRole} />
        </div>
      </aside>

      {/* Mobile/tablet: floating action button expands a bottom sheet, which can itself expand to fullscreen */}
      <div className="lg:hidden">
        <Button
          size="icon-lg"
          className="fixed right-4 bottom-4 z-40 size-14 rounded-full shadow-lg"
          aria-label={t("dock.openControls")}
          onClick={() => setSheetOpen(true)}
        >
          <PianoIcon className="size-6" />
          <span className={cn("absolute top-2 right-2 size-2.5 rounded-full ring-2 ring-primary", dotClass)} />
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" showCloseButton={false} className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
            <SheetTitle className="sr-only">{t("dock.title")}</SheetTitle>
            <div className="flex flex-col gap-4 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">{t("panel.title")}</p>
                <div className="flex items-center gap-1">
                  <ChromeIconButton icon={<Maximize2Icon className="size-4" />} label={t("panel.expand")} onClick={openFullscreen} />
                  <ChromeIconButton icon={<XIcon className="size-4" />} label={t("dock.close")} onClick={() => setSheetOpen(false)} />
                </div>
              </div>
              <PianoControlPanel songs={songs} viewerRole={viewerRole} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
};

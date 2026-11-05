"use client";

import { useState } from "react";
import Link from "next/link";
import { MenuIcon, PianoIcon } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { NavLinks } from "@/components/nav-links";

interface MobileNavProps {
  showAdmin: boolean;
}

/** Hamburger button + drawer carrying branding and navigation on viewports without the sidebar. */
export const MobileNav = ({ showAdmin }: MobileNavProps) => {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();

  return (
    <>
      <Button variant="ghost" size="icon" aria-label={t("nav.openMenu")} onClick={() => setOpen(true)}>
        <MenuIcon className="size-4" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72">
          <SheetTitle className="sr-only">{t("nav.menuTitle")}</SheetTitle>
          <div className="flex h-16 items-center px-5">
            <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <PianoIcon className="size-4" />
              </span>
              <span className="text-base font-semibold tracking-tight">{t("brand.name")}</span>
            </Link>
          </div>
          <div className="px-3 py-2">
            <NavLinks showAdmin={showAdmin} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

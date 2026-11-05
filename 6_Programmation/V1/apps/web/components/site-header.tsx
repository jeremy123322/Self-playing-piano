import Link from "next/link";
import { KeyRoundIcon, LogOutIcon, PianoIcon } from "lucide-react";
import { signOut } from "@/auth";
import type { ViewerRole } from "@/lib/authorization";
import { translate, type Locale } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { HeaderStatusPill } from "@/components/header-status-pill";
import { MobileNav } from "@/components/mobile-nav";

interface SiteHeaderProps {
  role: ViewerRole;
  locale: Locale;
}

const signOutAction = async () => {
  "use server";
  await signOut({ redirectTo: "/" });
};

const AuthAffordance = ({ role, locale }: { role: ViewerRole; locale: Locale }) => {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  if (role === "anonymous") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild size="sm">
            <Link href="/login">
              <KeyRoundIcon className="size-4" />
              <span className="hidden sm:inline">{t("header.enterAccessCode")}</span>
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("header.tooltip.enterAccessCode")}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary">{t(role === "admin" ? "header.role.admin" : "header.role.controller")}</Badge>
      <Tooltip>
        <TooltipTrigger asChild>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="icon" aria-label={t("header.signOut")}>
              <LogOutIcon className="size-4" />
            </Button>
          </form>
        </TooltipTrigger>
        <TooltipContent>{t("header.tooltip.signOut")}</TooltipContent>
      </Tooltip>
    </div>
  );
};

export const SiteHeader = ({ role, locale }: SiteHeaderProps) => {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        {/* Branding and navigation live in the sidebar on desktop; this drawer covers viewports without it. */}
        <div className="flex items-center gap-2 lg:hidden">
          <MobileNav showAdmin={role === "admin"} />
          <Link href="/" className="flex items-center">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PianoIcon className="size-4" />
            </span>
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <HeaderStatusPill />
          <LanguageToggle />
          <ThemeToggle />
          <AuthAffordance role={role} locale={locale} />
        </div>
      </div>
    </header>
  );
};

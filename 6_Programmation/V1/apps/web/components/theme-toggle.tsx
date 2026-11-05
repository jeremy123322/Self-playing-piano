"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);

  // Avoid rendering a theme-dependent icon before hydration to prevent a light/dark mismatch flash.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("theme.toggle")} onClick={toggleTheme} disabled={!mounted}>
          {isDark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t(isDark ? "theme.tooltip.dark" : "theme.tooltip.light")}</TooltipContent>
    </Tooltip>
  );
};

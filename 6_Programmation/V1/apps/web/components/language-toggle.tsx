"use client";

import { GlobeIcon } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { locales, type Locale } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const LOCALE_LABEL_KEY: Record<Locale, "language.en" | "language.fr"> = {
  en: "language.en",
  fr: "language.fr",
};

export const LanguageToggle = () => {
  const { locale, setLocale, t } = useLocale();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("language.toggle")}>
              <GlobeIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("language.tooltip")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
          {locales.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(LOCALE_LABEL_KEY[option])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/hooks/use-locale";
import { buildNavItems } from "@/lib/nav-items";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  showAdmin: boolean;
  onNavigate?: () => void;
}

/** Vertical navigation list shared by the desktop sidebar and the mobile nav drawer. */
export const NavLinks = ({ showAdmin, onNavigate }: NavLinksProps) => {
  const pathname = usePathname();
  const { t } = useLocale();
  const items = buildNavItems(showAdmin);

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            {...(onNavigate ? { onClick: onNavigate } : {})}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
};

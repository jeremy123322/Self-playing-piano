import { LibraryIcon, ShieldCheckIcon, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";

export interface NavItem {
  href: string;
  labelKey: MessageKey;
  icon: LucideIcon;
}

/** Admin only appears once signed in with the admin role; Library is always available. */
export const buildNavItems = (showAdmin: boolean): NavItem[] => [
  { href: "/", labelKey: "nav.library", icon: LibraryIcon },
  ...(showAdmin ? [{ href: "/admin", labelKey: "nav.admin" as MessageKey, icon: ShieldCheckIcon }] : []),
];

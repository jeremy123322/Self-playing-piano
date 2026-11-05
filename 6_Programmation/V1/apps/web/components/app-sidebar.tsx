import Link from "next/link";
import { PianoIcon } from "lucide-react";
import { translate, type Locale } from "@/lib/i18n/messages";
import { NavLinks } from "@/components/nav-links";

interface AppSidebarProps {
  showAdmin: boolean;
  locale: Locale;
}

/** Persistent left rail on desktop: carries branding and primary navigation, out of the header's way. */
export const AppSidebar = ({ showAdmin, locale }: AppSidebarProps) => (
  <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-border lg:bg-card/40">
    <div className="flex h-16 items-center px-5">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <PianoIcon className="size-4" />
        </span>
        <span className="text-base font-semibold tracking-tight">{translate(locale, "brand.name")}</span>
      </Link>
    </div>
    <div className="px-3 py-2">
      <NavLinks showAdmin={showAdmin} />
    </div>
  </aside>
);

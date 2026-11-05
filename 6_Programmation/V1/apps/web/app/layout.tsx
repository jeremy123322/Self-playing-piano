import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { cn } from "@/lib/utils";
import { viewerRole } from "@/lib/authorization";
import { readServerLocale } from "@/lib/i18n/locale-cookie";
import { LocaleProvider } from "@/hooks/use-locale";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { PianoSessionProvider } from "@/hooks/use-piano-session";

export const metadata: Metadata = {
  title: "Piano House",
  description: "Browse the library, watch the falling notes, and control the self-playing piano.",
};

const RootLayout = async ({ children }: Readonly<{ children: React.ReactNode }>) => {
  const [locale, role] = await Promise.all([readServerLocale(), viewerRole()]);

  return (
    <html lang={locale} className={cn(GeistSans.variable, GeistMono.variable)} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <LocaleProvider initialLocale={locale}>
            <TooltipProvider>
              <PianoSessionProvider>
                <div className="flex min-h-screen">
                  <AppSidebar showAdmin={role === "admin"} locale={locale} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <SiteHeader role={role} locale={locale} />
                    {children}
                  </div>
                </div>
                <Toaster position="bottom-right" />
              </PianoSessionProvider>
            </TooltipProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default RootLayout;

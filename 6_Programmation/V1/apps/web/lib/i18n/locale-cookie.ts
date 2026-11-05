import { cookies } from "next/headers";
import { defaultLocale, locales, LOCALE_COOKIE_NAME, type Locale } from "@/lib/i18n/messages";

const isLocale = (value: string | undefined): value is Locale => locales.includes(value as Locale);

export const readServerLocale = async (): Promise<Locale> => {
  const store = await cookies();
  const cookieValue = store.get(LOCALE_COOKIE_NAME)?.value;
  return isLocale(cookieValue) ? cookieValue : defaultLocale;
};

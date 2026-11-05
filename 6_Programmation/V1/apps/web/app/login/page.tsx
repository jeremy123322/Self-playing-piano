import Link from "next/link";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { readServerLocale } from "@/lib/i18n/locale-cookie";
import { translate } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface LoginPageProps {
  searchParams: Promise<{ admin?: string; callbackUrl?: string; error?: string }>;
}

const LoginPage = async ({ searchParams }: LoginPageProps) => {
  const [parameters, locale] = await Promise.all([searchParams, readServerLocale()]);
  const administrator = parameters.admin === "1";
  const redirectTo = administrator ? "/admin" : "/";
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t(administrator ? "login.adminTitle" : "login.unlockTitle")}</CardTitle>
          <CardDescription>{t(administrator ? "login.adminDescription" : "login.unlockDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            action={async (formData) => {
              "use server";
              try {
                await signIn("credentials", {
                  username: administrator ? formData.get("username") : "__piano_controller__",
                  password: formData.get("password"),
                  redirectTo,
                });
              } catch (error) {
                if (error instanceof AuthError) redirect(`/login?${administrator ? "admin=1&" : ""}error=1`);
                throw error;
              }
            }}
          >
            {administrator && (
              <div className="grid gap-1.5">
                <Label htmlFor="username">{t("login.username")}</Label>
                <Input id="username" name="username" autoComplete="username" required />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="password">{t(administrator ? "login.password" : "login.sharedPassword")}</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
            </div>
            {parameters.error && <p className="text-sm text-destructive">{t("login.errorMessage")}</p>}
            <Button type="submit" className="w-full">
              {t(administrator ? "login.signIn" : "login.unlock")}
            </Button>
            <Link
              href={administrator ? "/login" : "/login?admin=1"}
              className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {t(administrator ? "login.useSharedPassword" : "login.adminSignIn")}
            </Link>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

export default LoginPage;

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { verifyEncodedHash } from "@/lib/password-hash";

const credentialsSchema = z.object({ username: z.string(), password: z.string().min(1) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const result = credentialsSchema.safeParse(rawCredentials);
        if (!result.success) return null;
        if (result.data.username === "__piano_controller__") {
          const valid = await verifyEncodedHash(process.env.CONTROLLER_PASSWORD_HASH_BASE64, result.data.password);
          return valid ? { id: "controller", name: "Piano controller", role: "controller" } : null;
        }
        if (result.data.username !== (process.env.ADMIN_USERNAME ?? "admin")) return null;
        const valid = await verifyEncodedHash(process.env.ADMIN_PASSWORD_HASH_BASE64, result.data.password);
        return valid ? { id: "admin", name: "Piano administrator", role: "admin" } : null;
      },
    }),
  ],
  callbacks: {
    authorized: async ({ auth: session }) => Boolean(session),
    jwt: async ({ token, user }) => ({ ...token, ...(user ? { role: user.role } : {}) }),
    session: async ({ session, token }) => ({ ...session, user: { ...session.user, role: token.role as string } }),
  },
});

import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { ensureUserForSession, upsertGoogleIdentity } from "./tenant-service";

export const googleOAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export const authOptions: NextAuthOptions = {
  providers: googleOAuthConfigured
    ? [
        GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID ?? "",
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        }),
      ]
    : [],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-beezops-accounting.session-token"
          : "beezops-accounting.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && account.providerAccountId && user?.email) {
        token.appUserId = await upsertGoogleIdentity({
          email: user.email,
          displayName: user.name ?? null,
          providerSubject: account.providerAccountId,
        });
      } else if (!token.appUserId && token.email) {
        token.appUserId = await ensureUserForSession(token.email, token.name ?? null);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.appUserId) session.user.id = token.appUserId;
      return session;
    },
  },
};

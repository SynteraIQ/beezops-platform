import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

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
};

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "chefrobotics.ai")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const editorEmails = (process.env.EDITOR_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isEditor(email: string | null | undefined): boolean {
  if (!email) return false;
  return editorEmails.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email?.toLowerCase();
      if (!email) return false;
      const domain = email.split("@")[1];
      if (!allowedDomains.includes(domain)) return false;
      return true;
    },
    async session({ session }) {
      // attach role to session
      const email = session.user?.email;
      // @ts-expect-error augmenting session
      session.user.isEditor = isEditor(email);
      return session;
    },
  },
  trustHost: true,
});

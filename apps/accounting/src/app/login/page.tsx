import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions, googleOAuthConfigured } from "../../auth";
import { GoogleSignInButton } from "../sign-in-button";

export default async function LoginPage() {
  const session = googleOAuthConfigured ? await getServerSession(authOptions) : null;
  if (session?.user) redirect("/");

  return (
    <main className="login-page">
      <a className="brand login-brand" href="/" aria-label="BeezOps Accounting home">
        <span className="brand-mark">B</span><span>BeezOps<span className="brand-product"> / Accounting</span></span>
      </a>
      <section className="sign-in-card" aria-labelledby="page-title">
        <div className="eyebrow"><span className="eyebrow-line" />ACCOUNTING WORKSPACE</div>
        <h1 id="page-title">Sign in to BeezOps</h1>
        <p className="intro">Continue with your Google account to open your accounting workspace.</p>
        {googleOAuthConfigured ? (
          <GoogleSignInButton />
        ) : (
          <div className="setup-notice" role="status">
            <strong>Google sign-in needs configuration</strong>
            <span>Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>NEXTAUTH_SECRET</code> to <code>apps/accounting/.env.local</code>, then restart the app.</span>
          </div>
        )}
        <p className="privacy-note">Signing in identifies you. It does not connect Google Drive.</p>
      </section>
      <footer className="login-footer">BeezOps · Accounting intelligence</footer>
    </main>
  );
}

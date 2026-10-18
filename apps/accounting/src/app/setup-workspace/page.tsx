import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../auth";
import { getWorkspaceForUser } from "../../tenant-service";
import { WorkspaceSetupForm } from "./workspace-setup-form";

export default async function SetupWorkspacePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  if (await getWorkspaceForUser(session.user.id)) redirect("/");

  return (
    <main className="setup-page">
      <a className="brand setup-brand" href="/" aria-label="BeezOps Accounting home">
        <span className="brand-mark">B</span><span>BeezOps<span className="brand-product"> / Accounting</span></span>
      </a>
      <section className="setup-card">
        <div className="eyebrow"><span className="eyebrow-line" />FIRST-TIME SETUP</div>
        <h1>Create your workspace</h1>
        <p className="intro-copy">Choose the company or firm name your team will use in BeezOps Accounting.</p>
        <WorkspaceSetupForm />
        <p className="setup-footnote">Your workspace keeps its members, provider connections, and accounting context together.</p>
      </section>
    </main>
  );
}

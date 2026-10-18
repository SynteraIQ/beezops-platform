import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions, googleOAuthConfigured } from "../../auth";
import { SignOutButton } from "../sign-in-button";

export const workspaceSections = [
  "overview",
  "invoices",
  "approvals",
  "connections",
  "automations",
  "knowledge",
  "settings",
] as const;

export type WorkspaceSection = (typeof workspaceSections)[number];

export function isWorkspaceSection(value: string): value is WorkspaceSection {
  return workspaceSections.some((section) => section === value);
}

const navigation: ReadonlyArray<{ id: WorkspaceSection; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "invoices", label: "Invoices", icon: "▤" },
  { id: "approvals", label: "Approvals", icon: "✓" },
  { id: "connections", label: "Connections", icon: "⌘" },
  { id: "automations", label: "Automations", icon: "↻" },
  { id: "knowledge", label: "Knowledge", icon: "◉" },
];

const pageDetails: Record<WorkspaceSection, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "WORKSPACE OVERVIEW",
    title: "Accounts payable, with context.",
    description: "Bring invoice facts, company policy, and past decisions together before an approval is made.",
  },
  invoices: {
    eyebrow: "ACCOUNTS PAYABLE",
    title: "Invoices",
    description: "Review incoming invoices, extracted details, and the evidence behind each recommendation.",
  },
  approvals: {
    eyebrow: "HUMAN REVIEW",
    title: "Approvals",
    description: "See decisions that need a person’s review before the workflow can continue.",
  },
  connections: {
    eyebrow: "CONNECTED SYSTEMS",
    title: "Connections",
    description: "Connect the systems that provide invoice documents and business context.",
  },
  automations: {
    eyebrow: "WORKFLOW OPERATIONS",
    title: "Automations",
    description: "Inspect invoice processing workflows and their run history.",
  },
  knowledge: {
    eyebrow: "BUSINESS CONTEXT",
    title: "Knowledge",
    description: "The policies, vendor context, and reviewed decisions used to ground recommendations.",
  },
  settings: {
    eyebrow: "WORKSPACE ADMINISTRATION",
    title: "Settings",
    description: "Manage your BeezOps accounting workspace and account preferences.",
  },
};

export async function AccountingWorkspace({ section }: { section: WorkspaceSection }) {
  const session = googleOAuthConfigured ? await getServerSession(authOptions) : null;
  if (!session?.user) redirect("/login");

  const page = pageDetails[section];
  const userName = session.user.name ?? session.user.email ?? "Google user";
  const initial = userName.slice(0, 1).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="BeezOps Accounting home">
          <span className="brand-mark">B</span><span>BeezOps<span className="brand-product"> / Accounting</span></span>
        </Link>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher"><span className="workspace-icon">A</span><span className="workspace-name">Accounting workspace</span><span className="workspace-caret">⌄</span></div>

        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.id}
              className={`nav-item ${section === item.id ? "active" : ""}`}
              href={item.id === "overview" ? "/" : `/${item.id}`}
              aria-label={item.label}
              aria-current={section === item.id ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <Link className={`nav-item settings-link ${section === "settings" ? "active" : ""}`} href="/settings" aria-current={section === "settings" ? "page" : undefined}>
            <span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-label">Settings</span>
          </Link>
          <div className="account-block">
            <div className="avatar">{initial}</div>
            <div className="account-identity"><strong>{userName}</strong><span>{session.user.email ?? "Signed in with Google"}</span></div>
            <SignOutButton />
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>Accounting</span><span className="crumb-slash">/</span><strong>{section === "overview" ? "Overview" : page.title}</strong></div>
          <div className="topbar-right"><span className="environment-badge"><i />DEMO WORKSPACE</span><span className="topbar-divider" /><span className="topbar-user">{initial}</span></div>
        </header>
        <div className="content">
          <div className="page-intro">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" />{page.eyebrow}</div>
              <h1>{page.title}</h1>
              <p className="intro-copy">{page.description}</p>
            </div>
          </div>
          <WorkspaceSectionContent section={section} userEmail={session.user.email ?? ""} />
          <footer className="page-footer"><span>BEEZOPS · ACCOUNTING</span><span>Recommendations stay grounded in reviewable evidence.</span></footer>
        </div>
      </main>
    </div>
  );
}

function WorkspaceSectionContent({ section, userEmail }: { section: WorkspaceSection; userEmail: string }) {
  if (section === "overview") {
    return (
      <div className="workspace-content">
        <section className="welcome-card">
          <div className="welcome-copy"><span className="section-kicker">START HERE</span><h2>Your AP workspace is ready</h2><p>Connect an invoice source to begin reviewing extracted facts, supporting context, and approval decisions.</p></div>
          <Link className="primary-link" href="/connections">Open connections <span>↗</span></Link>
        </section>
        <section className="section-block">
          <div className="section-heading"><div><span className="section-kicker">PROCESS</span><h2>From invoice to decision</h2></div><span className="section-note">Human review stays in the loop</span></div>
          <div className="process-grid">
            <ProcessStep number="01" title="Receive" detail="Bring invoices in from a connected source." />
            <ProcessStep number="02" title="Understand" detail="Extract fields and gather relevant business context." />
            <ProcessStep number="03" title="Review" detail="Inspect evidence, uncertainty, and recommendations." />
            <ProcessStep number="04" title="Approve" detail="Route decisions to the right person." />
          </div>
        </section>
        <section className="empty-panel compact-empty"><div className="empty-symbol">▤</div><div><strong>No invoice activity yet</strong><span>Connect Google Drive to start an invoice intake flow.</span></div><Link href="/connections">View connections</Link></section>
      </div>
    );
  }

  if (section === "connections") {
    return (
      <div className="workspace-content">
        <section className="section-heading"><div><span className="section-kicker">DOCUMENT SOURCES</span><h2>Provider connections</h2></div><span className="section-note">Account access is separate from sign-in</span></section>
        <article className="provider-card">
          <div className="provider-logo google-drive-logo" aria-hidden="true"><svg viewBox="0 0 48 48"><path fill="#00832d" d="M16.4 4h12.1L43 29.1H30.9z"/><path fill="#0066da" d="M9.9 15.1 3.7 25.9 16.1 47h12.3L16.1 25.9z"/><path fill="#ffba00" d="M16.1 47h12.3l14.6-25.1H30.7z"/></svg></div>
          <div className="provider-copy"><div className="provider-title"><h2>Google Drive</h2><span className="status-pill status-off">Not connected</span></div><p>Import invoice files from a selected Drive folder. This provider connection will request Drive access separately from Google sign-in.</p><span className="provider-scopes">Provider: Google Drive <span>·</span> Status: not configured</span></div>
          <button className="secondary-button" type="button" disabled title="Google Drive connection flow is not configured yet">Connect Google Drive</button>
        </article>
        <div className="connection-note"><span className="note-icon">i</span><p><strong>Separate authorization</strong> — signing in with Google identifies your BeezOps user. Connecting Drive will be a separate consent flow with its own requested access.</p></div>
      </div>
    );
  }

  if (section === "invoices") {
    return <EmptySection icon="▤" title="No invoices to review" detail="Connect a source or add an invoice to begin. Each invoice view will show extracted fields, context used, recommendations, and evidence." action={{ href: "/connections", label: "Set up a connection" }} />;
  }
  if (section === "approvals") {
    return <EmptySection icon="✓" title="No decisions waiting for approval" detail="When an invoice needs a person’s judgment, it will appear here with the supporting evidence and any unresolved questions." action={{ href: "/invoices", label: "View invoices" }} />;
  }
  if (section === "automations") {
    return <EmptySection icon="↻" title="No automations configured" detail="Invoice intake, context gathering, verification, and approval routing will be managed here. Run history will be available alongside each automation." action={{ href: "/connections", label: "Connect an invoice source" }} />;
  }
  if (section === "knowledge") {
    return <EmptySection icon="◉" title="Knowledge will appear here" detail="Review the policies, vendor context, and validated learnings used to ground invoice recommendations. Each item will show its source and review status." />;
  }
  if (section === "settings") {
    return (
      <div className="workspace-content">
        <section className="settings-card"><span className="section-kicker">YOUR ACCOUNT</span><h2>Signed in with Google</h2><p>{userEmail}</p><p className="settings-note">This account is used to sign in to BeezOps. Provider connections such as Google Drive are managed separately under Connections.</p></section>
      </div>
    );
  }
  return null;
}

function ProcessStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <article className="process-step"><span className="step-number">{number}</span><strong>{title}</strong><p>{detail}</p></article>;
}

function EmptySection({ icon, title, detail, action }: { icon: string; title: string; detail: string; action?: { href: string; label: string } }) {
  return (
    <section className="empty-panel page-empty"><div className="empty-symbol">{icon}</div><strong>{title}</strong><p>{detail}</p>{action ? <Link href={action.href}>{action.label} <span>↗</span></Link> : null}</section>
  );
}

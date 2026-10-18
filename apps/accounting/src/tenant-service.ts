import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  authIdentities,
  getDatabase,
  organizationMemberships,
  organizations,
  users,
} from "@beezops/database";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export async function upsertGoogleIdentity(input: {
  email: string;
  displayName: string | null;
  providerSubject: string;
}): Promise<string> {
  const database = getDatabase();
  const email = normalizeEmail(input.email);
  const now = new Date();
  const [user] = await database
    .insert(users)
    .values({ email, displayName: input.displayName, updatedAt: now })
    .onConflictDoUpdate({
      target: users.email,
      set: { displayName: input.displayName, updatedAt: now },
    })
    .returning({ id: users.id });

  await database
    .insert(authIdentities)
    .values({
      userId: user.id,
      provider: "google",
      providerSubject: input.providerSubject,
      emailAtProvider: email,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [authIdentities.provider, authIdentities.providerSubject],
      set: { userId: user.id, emailAtProvider: email, lastSeenAt: now },
    });

  return user.id;
}

export async function ensureUserForSession(emailValue: string, displayName: string | null): Promise<string> {
  const email = normalizeEmail(emailValue);
  const now = new Date();
  const [user] = await getDatabase()
    .insert(users)
    .values({ email, displayName, updatedAt: now })
    .onConflictDoUpdate({ target: users.email, set: { displayName, updatedAt: now } })
    .returning({ id: users.id });
  return user.id;
}

export async function getWorkspaceForUser(userId: string): Promise<WorkspaceSummary | null> {
  const [workspace] = await getDatabase()
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(and(
      eq(organizationMemberships.userId, userId),
      eq(organizationMemberships.status, "active"),
      eq(organizations.status, "active"),
    ))
    .limit(1);

  return workspace ?? null;
}

export async function createWorkspaceForUser(userId: string, nameValue: string): Promise<WorkspaceSummary> {
  const name = nameValue.trim();
  if (name.length < 2 || name.length > 200) {
    throw new Error("Workspace name must be between 2 and 200 characters.");
  }

  const database = getDatabase();
  return database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
      .where(and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, "active"),
        eq(organizations.status, "active"),
      ))
      .limit(1);

    if (existing) return existing;

    const slugBase = slugify(name).slice(0, 140) || "workspace";
    const slug = `${slugBase}-${randomUUID().slice(0, 8)}`;
    const [organization] = await transaction
      .insert(organizations)
      .values({ name, slug })
      .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });

    await transaction.insert(organizationMemberships).values({
      organizationId: organization.id,
      userId,
      role: "owner",
    });

    return { ...organization, role: "owner" };
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

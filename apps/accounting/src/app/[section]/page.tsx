import { notFound } from "next/navigation";
import { AccountingWorkspace, isWorkspaceSection } from "../ui/accounting-workspace";

type SectionPageProps = {
  params: Promise<{ section: string }>;
};

export default async function SectionPage({ params }: SectionPageProps) {
  const { section } = await params;
  if (!isWorkspaceSection(section)) notFound();
  return <AccountingWorkspace section={section} />;
}

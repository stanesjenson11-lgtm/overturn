import CaseView from "@/components/CaseView";
import { PAID_TIER } from "@/lib/legal";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The id is not trusted here — /api/cases/[id] scopes it to the session, so an
  // id belonging to someone else renders an error, not their case.
  return <CaseView caseId={id} demo={!PAID_TIER} />;
}

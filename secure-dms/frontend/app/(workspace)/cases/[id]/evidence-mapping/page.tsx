import type { Metadata } from "next";
import { EvidenceGraph } from "@/components/evidence-graph";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Evidence Mapping",
};

export default function EvidenceMappingPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/dashboard" className="hover:underline">Dashboard</Link>
        <span className="px-2">/</span>
        <Link href="/cases" className="hover:underline">Cases</Link>
        <span className="px-2">/</span>
        <Link href={`/cases/${params.id}`} className="hover:underline">Case</Link>
        <span className="px-2">/</span>
        <span className="text-ink">Evidence Mapping</span>
      </nav>
      
      <header className="rounded-lg border border-line bg-white p-6">
        <h2 className="text-2xl font-semibold">Evidence Mapping</h2>
        <p className="mt-2 text-sm text-muted">Visual relationship graph of all case entities and their provenance.</p>
      </header>

      <EvidenceGraph caseId={params.id} />
    </div>
  );
}

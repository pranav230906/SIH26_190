import type { Metadata } from "next";
import { EvidenceView } from "@/components/evidence-view";

export const metadata: Metadata = { title: "Evidence vault" };

export default function CaseEvidencePage() {
  return <EvidenceView />;
}

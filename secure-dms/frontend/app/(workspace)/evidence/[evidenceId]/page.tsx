import type { Metadata } from "next";
import { EvidenceDetailView } from "@/components/evidence-detail-view";

export const metadata: Metadata = { title: "Evidence" };

export default function EvidencePage() {
  return <EvidenceDetailView />;
}

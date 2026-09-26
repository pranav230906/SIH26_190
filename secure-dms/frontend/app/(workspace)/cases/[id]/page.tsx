import type { Metadata } from "next";
import { CaseDetailView } from "@/components/case-detail-view";

export const metadata: Metadata = {
  title: "Case",
};

export default function CaseDetailPage() {
  return <CaseDetailView />;
}

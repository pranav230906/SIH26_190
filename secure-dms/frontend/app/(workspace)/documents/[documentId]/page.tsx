import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentDetailView } from "@/components/document-detail-view";

export const metadata: Metadata = {
  title: "Document",
};

export default function DocumentPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading document</p>}>
      <DocumentDetailView />
    </Suspense>
  );
}

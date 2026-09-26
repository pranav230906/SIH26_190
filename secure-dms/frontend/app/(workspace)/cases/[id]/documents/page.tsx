import type { Metadata } from "next";
import { DocumentsView } from "@/components/documents-view";

export const metadata: Metadata = {
  title: "Documents",
};

export default function CaseDocumentsPage() {
  return <DocumentsView />;
}

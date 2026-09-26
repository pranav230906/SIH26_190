import type { Metadata } from "next";
import { ArtifactDetailView } from "@/components/artifact-detail-view";

export const metadata: Metadata = { title: "Derived artifact" };

export default function ArtifactPage() {
  return <ArtifactDetailView />;
}

"use client";

import { useParams } from "next/navigation";
import { ForensicsView } from "@/components/forensics-view";

export default function CaseForensicsPage() {
  const params = useParams<{ id: string }>();
  return <ForensicsView caseId={params.id} />;
}

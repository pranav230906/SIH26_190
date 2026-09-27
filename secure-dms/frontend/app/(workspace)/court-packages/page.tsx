import { Suspense } from "react";
import { CourtPackagesView } from "@/components/court-packages-view";

export default function CourtPackagesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading court packages</p>}>
      <CourtPackagesView />
    </Suspense>
  );
}

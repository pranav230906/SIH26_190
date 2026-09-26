"use client";

import Link from "next/link";
import { can, usePermissions } from "@/components/session-context";

const PLACEHOLDERS = [
  { title: "Requests", note: "Access requests for this case are available below." },
  { title: "Revisions", note: "Module coming next" },
  { title: "AI Assistant", note: "Module coming next" },
  { title: "Court packages", note: "Module coming next" },
  { title: "Audit", note: "Case activity from the audit log is listed on this page." },
];

export function CaseModules({ caseId }: { caseId: string }) {
  const { permissions } = usePermissions();
  const documentsEnabled =
    can(permissions, "DOCUMENT.READ") ||
    can(permissions, "DOCUMENT.CREATE") ||
    can(permissions, "DOCUMENT.UPLOAD") ||
    can(permissions, "ACCESS_REQUEST.CREATE");
  const evidenceEnabled = can(permissions, "EVIDENCE.READ") || can(permissions, "EVIDENCE.UPLOAD");
  const forensicsEnabled = can(permissions, "FORENSIC_REPORT.READ") || can(permissions, "FORENSIC_REPORT.CREATE");

  return (
    <section aria-labelledby="case-modules">
      <h3 id="case-modules" className="text-base font-semibold">
        Case modules
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <li className="rounded-lg border border-line bg-white p-4">
          <p className="text-sm font-medium">Documents</p>
          {documentsEnabled ? (
            <Link href={`/cases/${caseId}/documents`} className="mt-3 inline-flex text-sm font-medium text-navy underline">
              Open documents
            </Link>
          ) : (
            <p className="mt-2 text-sm text-muted">Document access is not available for this role.</p>
          )}
        </li>
        <li className="rounded-lg border border-line bg-white p-4">
          <p className="text-sm font-medium">Evidence</p>
          {evidenceEnabled ? (
            <Link href={`/cases/${caseId}/evidence`} className="mt-3 inline-flex text-sm font-medium text-navy underline">
              Open evidence vault
            </Link>
          ) : (
            <p className="mt-2 text-sm text-muted">Evidence access is not available for this role.</p>
          )}
        </li>
        <li className="rounded-lg border border-line bg-white p-4">
          <p className="text-sm font-medium">Forensics</p>
          {forensicsEnabled ? (
            <Link href={`/cases/${caseId}/forensics`} className="mt-3 inline-flex text-sm font-medium text-navy underline">
              Open forensic requests
            </Link>
          ) : (
            <p className="mt-2 text-sm text-muted">Forensic requests are not available for this role.</p>
          )}
        </li>
        {PLACEHOLDERS.map((item) => (
          <li key={item.title} className="rounded-lg border border-dashed border-line bg-white p-4">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="mt-2 text-sm text-muted">{item.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

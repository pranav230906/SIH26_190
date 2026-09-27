"use client";

import Link from "next/link";
import { can, usePermissions } from "@/components/session-context";

const PLACEHOLDERS = [
  { title: "Access Requests", note: "Manage case access", available: true },
  { title: "AI Assistant", note: "Case-isolated retrieval", available: true },
  { title: "Audit Trail", note: "Security and event logs", available: true },
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
  const courtPackagesEnabled = can(permissions, "COURT_PACKAGE.READ") || can(permissions, "COURT_PACKAGE.CREATE");

  return (
    <section aria-labelledby="case-modules">
      <h3 id="case-modules" className="text-base font-semibold text-slate-900 mb-4">
        Workspace Modules
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {documentsEnabled ? (
          <Link href={`/cases/${caseId}/documents`} className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
            <div>
              <div className="mb-3 inline-flex rounded-lg bg-blue-50 p-2 text-blue-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </div>
              <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">Documents</p>
              <p className="mt-1 text-xs text-slate-500">View and manage case files</p>
            </div>
          </Link>
        ) : (
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-5 opacity-60">
            <p className="text-sm font-semibold text-slate-700">Documents</p>
            <p className="mt-1 text-xs text-slate-500">Restricted access</p>
          </div>
        )}
        
        {evidenceEnabled ? (
          <Link href={`/cases/${caseId}/evidence`} className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
            <div>
              <div className="mb-3 inline-flex rounded-lg bg-blue-50 p-2 text-blue-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
              </div>
              <p className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">Evidence Vault</p>
              <p className="mt-1 text-xs text-slate-500">Secure evidence storage</p>
            </div>
          </Link>
        ) : (
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-5 opacity-60">
            <p className="text-sm font-semibold text-slate-700">Evidence Vault</p>
            <p className="mt-1 text-xs text-slate-500">Restricted access</p>
          </div>
        )}

        {forensicsEnabled ? (
          <Link href={`/cases/${caseId}/forensics`} className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
            <div>
              <div className="mb-3 inline-flex rounded-lg bg-purple-50 p-2 text-purple-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
              </div>
              <p className="text-sm font-semibold text-slate-900 group-hover:text-purple-600 transition-colors">Forensics</p>
              <p className="mt-1 text-xs text-slate-500">Analysis and reports</p>
            </div>
          </Link>
        ) : (
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-5 opacity-60">
            <p className="text-sm font-semibold text-slate-700">Forensics</p>
            <p className="mt-1 text-xs text-slate-500">Restricted access</p>
          </div>
        )}

        {courtPackagesEnabled ? (
          <Link href={`/court-packages?case_id=${caseId}`} className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
            <div>
              <div className="mb-3 inline-flex rounded-lg bg-amber-50 p-2 text-amber-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>
              </div>
              <p className="text-sm font-semibold text-slate-900 group-hover:text-amber-600 transition-colors">Court Packages</p>
              <p className="mt-1 text-xs text-slate-500">Legal handoff bundles</p>
            </div>
          </Link>
        ) : (
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-5 opacity-60">
            <p className="text-sm font-semibold text-slate-700">Court Packages</p>
            <p className="mt-1 text-xs text-slate-500">Restricted access</p>
          </div>
        )}

        <Link href={`/cases/${caseId}/evidence-mapping`} className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all">
          <div>
            <div className="mb-3 inline-flex rounded-lg bg-indigo-50 p-2 text-indigo-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
            </div>
            <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">Evidence Graph</p>
            <p className="mt-1 text-xs text-slate-500">Visual mapping</p>
          </div>
        </Link>
        
        {PLACEHOLDERS.map((item) => (
          <div key={item.title} className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="mt-1 text-xs text-slate-500">{item.note}</p>
            </div>
            {item.available && (
              <a href={item.title === "Access Requests" ? "#requests" : "#"} className="mt-3 text-xs font-medium text-slate-400 hover:text-slate-600">
                View on page ↓
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

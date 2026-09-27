"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";

type AuditItem = {
  id: string;
  event_type: string;
  user_name: string | null;
  document_title: string | null;
  case_number: string | null;
  created_at: string;
  severity: string;
};

export function AuditTimeline({
  title,
  caseId,
  documentId,
}: {
  title: string;
  caseId?: string;
  documentId?: string;
}) {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page: "1", page_size: "20" });
    if (caseId) {
      params.set("case_id", caseId);
    }
    if (documentId) {
      params.set("document_id", documentId);
    }
    let active = true;
    apiFetch<{ items: AuditItem[] }>(`/api/audit/events?${params.toString()}`)
      .then((data) => {
        if (active) {
          setItems(data.items);
        }
      })
      .catch(() => {
        if (active) {
          setError("Audit history is not available.");
        }
      });
    return () => {
      active = false;
    };
  }, [caseId, documentId]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm font-mono text-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
        <h3 className="text-sm font-bold tracking-widest text-slate-900 uppercase flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          {title}
        </h3>
        <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Immutable Ledger</span>
      </div>
      
      {error ? <p className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 p-3 rounded-lg shadow-sm">{error}</p> : null}
      {!error && items.length === 0 ? <p className="mt-3 text-sm text-slate-500 italic px-2 font-sans">No audit events are recorded yet.</p> : null}
      
      <ol className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.id} className="text-xs hover:bg-slate-50 p-3 rounded-lg transition-colors flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4 border-l-4 border-slate-200 hover:border-blue-500">
            <span className="text-slate-500 whitespace-nowrap">[{formatTimestamp(item.created_at)}]</span>
            <div className="flex-1 font-semibold">
              <span className={`mr-2 ${item.severity === 'SECURITY' ? 'text-red-600' : item.severity === 'WARNING' ? 'text-amber-600' : 'text-blue-600'}`}>
                {item.event_type}
              </span>
              <span className="text-slate-700">{item.user_name ? `@${item.user_name.replace(/\s+/g, '_').toLowerCase()}` : "SYSTEM"}</span>
              {item.document_title ? <span className="ml-2 text-slate-500 font-medium">&gt; {item.document_title}</span> : null}
              {!documentId && item.case_number ? <span className="ml-2 text-slate-400 font-medium">[{item.case_number}]</span> : null}
            </div>
            <span className="text-slate-400 font-mono text-[9px] uppercase font-bold">{item.id.slice(0, 8)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

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

type GroupedAuditItem = AuditItem & { count: number };

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
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    // Fetch a larger page size to allow proper grouping on the frontend (max 50 allowed by backend)
    const params = new URLSearchParams({ page: "1", page_size: "50" });
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

  // Process items: filter routine access for "important" view, or group similar events for "full" view
  const processedItems = (): GroupedAuditItem[] => {
    const ignoredForImportant = ["CASE_ACCESSED", "DASHBOARD_ACCESSED", "DOCUMENT_VIEWED"];
    
    let filtered = items;
    if (!showFull) {
      // In the default "Important Only" view, we filter out routine access events, unless it's specifically evidence viewed or edited
      filtered = items.filter(
        (i) => !ignoredForImportant.includes(i.event_type) || i.event_type.startsWith("EVIDENCE_")
      );
    }

    const grouped: GroupedAuditItem[] = [];
    for (const item of filtered) {
      if (grouped.length === 0) {
        grouped.push({ ...item, count: 1 });
        continue;
      }
      
      const last = grouped[grouped.length - 1];
      const timeDiffMs = new Date(last.created_at).getTime() - new Date(item.created_at).getTime();
      const withinShortPeriod = timeDiffMs < 30 * 60 * 1000; // 30 minutes

      if (
        last.event_type === item.event_type &&
        last.user_name === item.user_name &&
        last.document_title === item.document_title &&
        withinShortPeriod
      ) {
        // Group similar events
        last.count += 1;
      } else {
        grouped.push({ ...item, count: 1 });
      }
    }

    return grouped.slice(0, 15); // Show top 15 groups
  };

  const displayItems = processedItems();

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm font-sans text-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 p-5">
        <h3 className="text-sm font-bold tracking-widest text-slate-900 uppercase flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          {title}
        </h3>
        
        <button 
          type="button" 
          onClick={() => setShowFull(!showFull)}
          className="text-[10px] uppercase tracking-widest font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition-colors"
        >
          {showFull ? "Show Important Only" : "Show Full Audit Trail"}
        </button>
      </div>
      
      <div className="p-5">
        {error ? <p className="text-sm text-red-800 bg-red-50 border border-red-200 p-3 rounded-lg shadow-sm">{error}</p> : null}
        {!error && displayItems.length === 0 ? <p className="text-sm text-slate-500 italic">No audit events match this view.</p> : null}
        
        <div className="space-y-4">
          {displayItems.map((item) => (
            <div key={item.id} className="group flex gap-4">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full mt-1.5 ${item.severity === 'SECURITY' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : item.severity === 'WARNING' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                <div className="w-px h-full bg-slate-200 mt-2 group-last:bg-transparent" />
              </div>
              
              <div className="flex-1 pb-4">
                <div className="flex items-center justify-between gap-4">
                  <span className={`text-xs font-bold uppercase tracking-wider ${item.severity === 'SECURITY' ? 'text-red-600' : item.severity === 'WARNING' ? 'text-amber-600' : 'text-blue-700'}`}>
                    {item.event_type}
                    {item.count > 1 && (
                      <span className="ml-2 inline-flex items-center justify-center bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full text-[9px]">
                        {item.count}x
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 whitespace-nowrap">
                    {formatTimestamp(item.created_at)}
                  </span>
                </div>
                
                <p className="text-sm font-medium text-slate-700 mt-1">
                  User <span className="font-bold text-slate-900">{item.user_name ? `@${item.user_name.replace(/\s+/g, '_').toLowerCase()}` : "SYSTEM"}</span>
                  {item.document_title ? (
                     <span> accessed document <span className="text-slate-900 font-bold">{item.document_title}</span></span>
                  ) : null}
                  {!documentId && item.case_number ? (
                     <span className="text-slate-500"> in case <span className="font-mono">{item.case_number}</span></span>
                  ) : null}
                </p>
                <div className="mt-2 text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded inline-block border border-slate-100">
                  REF: {item.id}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

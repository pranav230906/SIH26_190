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
    <section className="rounded-lg border border-line bg-white p-6">
      <h3 className="text-base font-semibold">{title}</h3>
      {error ? <p className="mt-3 text-sm text-muted">{error}</p> : null}
      {!error && items.length === 0 ? <p className="mt-3 text-sm text-muted">No audit events are recorded yet.</p> : null}
      <ol className="mt-4 space-y-3 border-l border-line pl-4">
        {items.map((item) => (
          <li key={item.id} className="text-sm">
            <p className="text-muted">{formatTimestamp(item.created_at)}</p>
            <p className="font-medium">
              {item.event_type.replaceAll("_", " ")}
              {item.user_name ? ` · ${item.user_name}` : ""}
            </p>
            {item.document_title ? <p>{item.document_title}</p> : null}
            {!documentId && item.case_number ? <p className="text-muted">{item.case_number}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiFetchBlob, ApiClientError } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";
import { can, usePermissions } from "@/components/session-context";

type AuditItem = {
  id: string;
  event_type: string;
  severity: string;
  user_name: string | null;
  case_number: string | null;
  document_title: string | null;
  created_at: string;
};

type AuditDetail = AuditItem & {
  user_id: string | null;
  case_id: string | null;
  document_id: string | null;
  version_id: string | null;
  evidence_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, string>;
  previous_hash: string;
  event_hash: string;
  hash_algorithm: string;
  integrity: string;
};

type Summary = {
  total_events: number;
  events_today: number;
  security_events: number;
  failed_logins: number;
  access_requests: number;
  system_wide: boolean;
};

type Status = {
  status: string;
  last_verified_at: string | null;
  events_checked: number;
  failed_event_id: string | null;
  reason: string | null;
};

export function AuditView() {
  const { permissions } = usePermissions();
  const allowed = can(permissions, "AUDIT_LOG.READ");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<"idle" | "running" | "done">("idle");
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    case_number: "",
    document_number: "",
    evidence_number: "",
    username: "",
    event_type: "",
    severity: "",
    start_date: "",
    end_date: "",
  });

  const load = useCallback(async () => {
    if (!allowed) {
      return;
    }
    const params = new URLSearchParams({ page: String(page), page_size: "20" });
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }
    const [summaryData, statusData, events] = await Promise.all([
      apiFetch<Summary>("/api/audit/summary"),
      apiFetch<Status>("/api/audit/status"),
      apiFetch<{ items: AuditItem[]; total: number }>(`/api/audit/events?${params.toString()}`),
    ]);
    setSummary(summaryData);
    setStatus(statusData);
    setItems(events.items);
    setTotal(events.total);
  }, [allowed, filters, page]);

  useEffect(() => {
    if (!allowed) {
      return;
    }
    load().catch((caught) => {
      setError(caught instanceof ApiClientError ? caught.message : "The audit log could not be loaded.");
    });
  }, [allowed, load]);

  async function openEvent(id: string) {
    setSelected(await apiFetch<AuditDetail>(`/api/audit/events/${id}`));
  }

  async function verify() {
    setVerifyState("running");
    setError(null);
    try {
      const result = await apiFetch<{ status: string; failed_event_id: string | null; reason: string | null; events_checked: number }>(
        "/api/audit/verify",
        { method: "POST" },
      );
      setVerifyResult(
        result.status === "VALID"
          ? `Audit chain verified. ${result.events_checked} events checked.`
          : `Integrity issue detected. Event ${result.failed_event_id ?? ""}. ${result.reason ?? ""}`.trim(),
      );
      setVerifyState("done");
      await load();
    } catch (caught) {
      setVerifyState("idle");
      setError(caught instanceof ApiClientError ? caught.message : "Verification could not be completed.");
    }
  }

  async function exportLog(format: "csv" | "json") {
    const params = new URLSearchParams({ export_format: format });
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }
    const file = await apiFetchBlob(`/api/audit/export?${params.toString()}`);
    const url = URL.createObjectURL(file.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename ?? `audit-events.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!allowed) {
    return <p className="text-sm text-muted">The system audit log is available to the audit administrator.</p>;
  }

  const chainLabel = statusLabel(verifyResult, status);

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm font-mono">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
          <div>
             <p className="text-[10px] text-slate-500 tracking-widest uppercase mb-1 font-bold">System Security Audit</p>
             <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3 tracking-wide">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                Cryptographic Audit Chain
             </h2>
          </div>
          <div className="text-right">
             <p className={`text-sm font-bold uppercase tracking-wider ${chainLabel.tone === 'text-danger' ? 'text-red-600' : chainLabel.tone === 'text-navy' ? 'text-green-600' : 'text-slate-500'}`}>{chainLabel.text}</p>
             {status?.last_verified_at ? <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Last verified: {formatTimestamp(status.last_verified_at)}</p> : null}
          </div>
        </div>

        {status?.status === "TAMPER_DETECTED" ? (
          <div className="mb-6 bg-red-50 border-2 border-red-200 p-4 rounded-lg text-red-800 text-sm flex items-start gap-3 shadow-sm">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div>
               <p className="font-bold tracking-wide">INTEGRITY BREACH DETECTED</p>
               <p className="mt-1">Event <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded text-red-900 border border-red-200 font-bold">{status.failed_event_id}</span> failed validation: {status.reason}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4">
          <button type="button" className="rounded-lg border-2 border-blue-600 bg-blue-600 hover:bg-blue-700 transition-colors px-5 py-2.5 text-sm font-bold text-white flex items-center gap-2 shadow-sm" disabled={verifyState === "running"} onClick={verify}>
            {verifyState === "running" ? (
               <><svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Verifying Chain...</>
            ) : (
               <><svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg> Verify Integrity</>
            )}
          </button>
          <button type="button" className="rounded-lg border-2 border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 transition-colors px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm" onClick={() => exportLog("csv")}>
            Export .CSV
          </button>
          <button type="button" className="rounded-lg border-2 border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 transition-colors px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm" onClick={() => exportLog("json")}>
            Export .JSON
          </button>
        </div>
        {verifyResult ? <p className="mt-5 text-sm font-bold text-green-700 bg-green-50 p-3 border border-green-200 rounded-lg shadow-sm inline-block">{verifyResult}</p> : null}
      </header>

      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Events" value={summary?.total_events ?? 0} />
        <Stat label="Today" value={summary?.events_today ?? 0} />
        <Stat label="Sensitive actions" value={summary?.security_events ?? 0} />
        <Stat label="Failed logins" value={summary?.failed_logins ?? 0} />
        <Stat label="Access requests" value={summary?.access_requests ?? 0} />
      </section>

      <form
        className="grid gap-4 rounded-xl border border-slate-200 bg-white shadow-sm p-6 md:grid-cols-4 font-mono"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          load().catch(() => setError("The audit log could not be loaded."));
        }}
      >
        <Field label="Case Context" value={filters.case_number} onChange={(value) => setFilters({ ...filters, case_number: value })} placeholder="CASE-2026-001" />
        <Field label="Document Trace" value={filters.document_number} onChange={(value) => setFilters({ ...filters, document_number: value })} placeholder="DOC-2026-000001" />
        <Field label="Evidence Trace" value={filters.evidence_number} onChange={(value) => setFilters({ ...filters, evidence_number: value })} placeholder="EVD-2026-000001" />
        <Field label="System User" value={filters.username} onChange={(value) => setFilters({ ...filters, username: value })} placeholder="officer username" />
        <Field label="Event Signature" value={filters.event_type} onChange={(value) => setFilters({ ...filters, event_type: value })} placeholder="DOCUMENT_VIEWED" />
        <label className="text-xs text-slate-500 uppercase tracking-widest font-bold">
          Severity Level
          <select className="mt-1.5 w-full rounded border-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-sans font-medium" value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}>
            <option value="">ALL LEVELS</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="SECURITY">SECURITY</option>
          </select>
        </label>
        <Field label="Timeframe Start" type="date" value={filters.start_date} onChange={(value) => setFilters({ ...filters, start_date: value })} />
        <Field label="Timeframe End" type="date" value={filters.end_date} onChange={(value) => setFilters({ ...filters, end_date: value })} />
        <div className="md:col-span-4 flex justify-end mt-4">
           <button type="submit" className="rounded-lg border-2 border-blue-600 bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors px-6 py-2.5 text-sm font-bold tracking-widest uppercase flex items-center gap-2 shadow-sm">
             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
             Apply Filter Schema
           </button>
        </div>
      </form>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm font-mono text-slate-900">
        <table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead className="border-b-2 border-slate-200 bg-slate-50 text-xs tracking-wider text-slate-500 uppercase font-sans font-bold">
            <tr>
              <th className="px-6 py-4 text-left">Timestamp</th>
              <th className="px-6 py-4 text-left">User</th>
              <th className="px-6 py-4 text-left">Action</th>
              <th className="px-6 py-4 text-left">Context</th>
              <th className="px-6 py-4 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td className="px-6 py-8 text-center text-slate-500 italic font-sans" colSpan={5}>No events match these filters.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="cursor-pointer hover:bg-blue-50/50 transition-colors border-l-4 border-transparent hover:border-blue-500" onClick={() => openEvent(item.id)}>
                  <td className="px-6 py-4 text-slate-500 text-xs">[{formatTimestamp(item.created_at)}]</td>
                  <td className="px-6 py-4 font-semibold text-slate-700">{item.user_name ? `@${item.user_name.replace(/\s+/g, '_').toLowerCase()}` : "SYSTEM"}</td>
                  <td className={`px-6 py-4 font-bold text-xs ${item.severity === 'SECURITY' ? 'text-red-600' : item.severity === 'WARNING' ? 'text-amber-600' : 'text-blue-600'}`}>{item.event_type}</td>
                  <td className="px-6 py-4 text-xs font-semibold">
                     {item.case_number ? <span className="text-slate-500 mr-2">[{item.case_number}]</span> : null}
                     {item.document_title ? <span className="text-slate-700">&gt; {item.document_title}</span> : null}
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${item.severity === 'SECURITY' ? 'bg-red-50 text-red-600 border border-red-200' : item.severity === 'WARNING' ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                      {item.severity}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-between text-sm font-sans font-bold bg-white border border-slate-200 shadow-sm p-4 rounded-xl text-slate-700">
        <p className="text-slate-500">{total} events in scope</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border-2 border-slate-200 px-4 py-2 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-600 uppercase tracking-wider text-xs" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            &lt; Prev
          </button>
          <button type="button" className="rounded-lg border-2 border-slate-200 px-4 py-2 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-slate-600 uppercase tracking-wider text-xs" disabled={page * 20 >= total} onClick={() => setPage((current) => current + 1)}>
            Next &gt;
          </button>
        </div>
      </div>

      {selected ? (
        <aside className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xl font-mono text-slate-900 ring-2 ring-blue-500/20">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Event Details
              </h3>
              <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-bold">{selected.id}</p>
            </div>
            <button type="button" className="text-slate-400 hover:text-slate-700 transition-colors bg-slate-50 p-2 rounded-lg" onClick={() => setSelected(null)}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2">
            <Detail label="Event Type" value={selected.event_type} />
            <Detail label="Timestamp" value={formatTimestamp(selected.created_at)} />
            <Detail label="User" value={selected.user_name ?? "SYSTEM"} />
            <Detail label="Context" value={[selected.case_number, selected.document_title, selected.version_id].filter(Boolean).join(" / ") || "None"} />
            
            <div className="sm:col-span-2 border-t-2 border-slate-100 pt-4 mt-2">
               <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                 Cryptographic Trace
               </h4>
            </div>
            <Detail label="Hash Algorithm" value={selected.hash_algorithm} />
            <Detail label="Integrity" value={selected.integrity} />
            
            <div className="sm:col-span-2 space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
               <div>
                 <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1 font-bold">Previous Hash (Chain Link)</dt>
                 <dd className="break-all font-mono text-xs bg-white p-3 rounded border border-slate-200 text-slate-500 shadow-sm">{selected.previous_hash}</dd>
               </div>
               <div>
                 <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1 font-bold">Event Hash (Signature)</dt>
                 <dd className="break-all font-mono text-xs bg-white p-3 rounded border border-slate-200 text-blue-700 font-semibold shadow-sm">{selected.event_hash}</dd>
               </div>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function statusLabel(verifyResult: string | null, status: Status | null): { text: string; tone: string } {
  if (verifyResult?.startsWith("Integrity")) {
    return { text: "Integrity issue detected", tone: "text-danger" };
  }
  if (verifyResult?.startsWith("Audit chain verified") || status?.status === "VALID") {
    return { text: "Verified", tone: "text-navy" };
  }
  if (status?.status === "TAMPER_DETECTED") {
    return { text: "Integrity issue detected", tone: "text-danger" };
  }
  return { text: "Not verified yet", tone: "text-muted" };
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-between">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 font-sans mb-3 flex items-center gap-2">
         <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
         {label}
      </p>
      <p className="text-4xl font-black text-slate-900 font-mono tracking-tight">{value.toLocaleString("en-GB")}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-xs text-slate-500 uppercase tracking-widest font-bold">
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-sans font-medium" />
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</dt>
      <dd className="break-words font-semibold text-slate-900 text-sm">{value}</dd>
    </div>
  );
}

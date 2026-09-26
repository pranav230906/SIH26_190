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
      <header className="rounded-lg border border-line bg-white p-6">
        <p className="text-sm text-muted">Security audit</p>
        <h2 className="mt-1 text-2xl font-semibold text-navy">Audit chain</h2>
        <p className={`mt-3 text-sm font-medium ${chainLabel.tone}`}>{chainLabel.text}</p>
        {status?.last_verified_at ? <p className="mt-1 text-sm text-muted">Last checked {formatTimestamp(status.last_verified_at)}</p> : null}
        {status?.status === "TAMPER_DETECTED" ? (
          <p className="mt-2 text-sm">
            Event {status.failed_event_id}. Failure {status.reason}.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={verifyState === "running"} onClick={verify}>
            {verifyState === "running" ? "Verifying..." : "Verify audit integrity"}
          </button>
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => exportLog("csv")}>
            Export CSV
          </button>
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => exportLog("json")}>
            Export JSON
          </button>
        </div>
        {verifyResult ? <p className="mt-3 text-sm">{verifyResult}</p> : null}
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
        className="grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          load().catch(() => setError("The audit log could not be loaded."));
        }}
      >
        <Field label="Case" value={filters.case_number} onChange={(value) => setFilters({ ...filters, case_number: value })} placeholder="CASE-2026-001" />
        <Field label="Document" value={filters.document_number} onChange={(value) => setFilters({ ...filters, document_number: value })} placeholder="DOC-2026-000001" />
        <Field label="Evidence" value={filters.evidence_number} onChange={(value) => setFilters({ ...filters, evidence_number: value })} placeholder="EVD-2026-000001" />
        <Field label="User" value={filters.username} onChange={(value) => setFilters({ ...filters, username: value })} placeholder="officer username" />
        <Field label="Event type" value={filters.event_type} onChange={(value) => setFilters({ ...filters, event_type: value })} placeholder="DOCUMENT_VIEWED" />
        <label className="text-sm">
          Status
          <select className="mt-1 w-full rounded-md border border-line px-3 py-2" value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })}>
            <option value="">All</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="SECURITY">SECURITY</option>
          </select>
        </label>
        <Field label="From" type="date" value={filters.start_date} onChange={(value) => setFilters({ ...filters, start_date: value })} />
        <Field label="To" type="date" value={filters.end_date} onChange={(value) => setFilters({ ...filters, end_date: value })} />
        <button type="submit" className="w-fit rounded-md border border-line px-3 py-2 text-sm md:col-span-3">
          Apply filters
        </button>
      </form>

      <section className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Case</th>
              <th className="px-4 py-3 font-medium">Document</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="cursor-pointer border-b border-line last:border-0" onClick={() => openEvent(item.id)}>
                <td className="px-4 py-3">{formatTimestamp(item.created_at)}</td>
                <td className="px-4 py-3">{item.user_name ?? "Unknown"}</td>
                <td className="px-4 py-3">{item.event_type}</td>
                <td className="px-4 py-3">{item.case_number ?? ""}</td>
                <td className="px-4 py-3">{item.document_title ?? ""}</td>
                <td className="px-4 py-3">{item.severity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No events match these filters.</p> : null}
      </section>

      <div className="flex items-center justify-between text-sm">
        <p className="text-muted">{total} events in scope</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Previous
          </button>
          <button type="button" className="rounded-md border border-line px-3 py-2" disabled={page * 20 >= total} onClick={() => setPage((current) => current + 1)}>
            Next
          </button>
        </div>
      </div>

      {selected ? (
        <aside className="rounded-lg border border-line bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-base font-semibold">Event details</h3>
            <button type="button" className="text-sm text-navy underline" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Event ID" value={selected.id} />
            <Detail label="Event" value={selected.event_type} />
            <Detail label="User" value={selected.user_name ?? "Unknown"} />
            <Detail label="Case" value={selected.case_number ?? "None"} />
            <Detail label="Document" value={selected.document_title ?? "None"} />
            <Detail label="Version" value={selected.version_id ?? "None"} />
            <Detail label="Timestamp" value={formatTimestamp(selected.created_at)} />
            <Detail label="Hash algorithm" value={selected.hash_algorithm} />
            <Detail label="Integrity" value={selected.integrity} />
            <Detail label="Previous hash" value={selected.previous_hash} />
            <Detail label="Event hash" value={selected.event_hash} />
          </dl>
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
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy">{value.toLocaleString("en-GB")}</p>
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
    <label className="text-sm">
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:col-span-2">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 break-all">{value}</dd>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch } from "@/lib/api";
import { evidenceTypeLabel, forensicStatusLabel, forensicTypeLabel, formatTimestamp } from "@/lib/format";
import type { EvidenceListResponse, ForensicRequestDetail, ForensicRequestSummary } from "@/lib/types";

const REQUEST_TYPES = [
  "DIGITAL_FORENSICS",
  "VIDEO_ANALYSIS",
  "IMAGE_ANALYSIS",
  "AUDIO_ANALYSIS",
  "MOBILE_FORENSICS",
  "DISK_FORENSICS",
  "DOCUMENT_FORENSICS",
  "OTHER",
];

export function ForensicsView({ caseId }: { caseId: string }) {
  const { permissions } = usePermissions();
  const [items, setItems] = useState<ForensicRequestSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const canCreate = can(permissions, "FORENSIC_REPORT.CREATE");

  async function reload() {
    const data = await apiFetch<{ items: ForensicRequestSummary[] }>(`/api/cases/${caseId}/forensic-requests`);
    setItems(data.items);
  }

  useEffect(() => {
    reload().catch((caught) => {
      setError(caught instanceof ApiClientError ? caught.message : "Forensic requests could not be loaded.");
    });
  }, [caseId]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-2">
            <Link href={`/cases/${caseId}`} className="hover:text-blue-600 transition-colors">Case</Link>
            <span>/</span>
            <span className="text-slate-900">Forensics</span>
          </nav>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Forensic Requests</h2>
        </div>
        {canCreate ? (
          <button type="button" className="rounded-md bg-purple-600 hover:bg-purple-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm flex items-center gap-2" onClick={() => setOpen(true)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            Request Examination
          </button>
        ) : null}
      </header>
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wider text-slate-500 uppercase font-semibold">
            <tr>
              <th className="px-6 py-4">Request</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Requested By</th>
              <th className="px-6 py-4">Assigned Examiner</th>
              <th className="px-6 py-4">Evidence</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td className="px-6 py-8 text-center text-slate-500" colSpan={6}>No forensic requests are visible for this case.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900">{item.request_number}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{forensicTypeLabel(item.request_type)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      item.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                      item.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                      item.status === 'PENDING_APPROVAL' ? 'bg-amber-100 text-amber-800' :
                      'bg-purple-100 text-purple-800'
                    }`}>
                      {forensicStatusLabel(item.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-slate-900 font-medium">{item.requested_by_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatTimestamp(item.created_at).split(' ')[0]}</p>
                  </td>
                  <td className="px-6 py-4 text-slate-700">{item.assigned_to_name ?? "Unassigned"}</td>
                  <td className="px-6 py-4 text-slate-700 font-mono text-xs">{item.evidence_count} items</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/forensic-requests/${item.id}`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm">
                        Open Report
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {open ? (
        <RequestForm
          caseId={caseId}
          onClose={() => setOpen(false)}
          onCreated={async (created) => {
            setOpen(false);
            setNotice(`${created.request_number} is waiting for approval.`);
            await reload();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function RequestForm({
  caseId,
  onClose,
  onCreated,
  onError,
}: {
  caseId: string;
  onClose: () => void;
  onCreated: (request: ForensicRequestDetail) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [evidence, setEvidence] = useState<EvidenceListResponse["items"]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [requestType, setRequestType] = useState("VIDEO_ANALYSIS");
  const [reason, setReason] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<EvidenceListResponse>(`/api/cases/${caseId}/evidence?page_size=100`)
      .then((data) => setEvidence(data.items))
      .catch((caught) => onError(caught instanceof ApiClientError ? caught.message : "Evidence could not be loaded."));
  }, [caseId, onError]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (selected.length === 0) {
      onError("Select at least one evidence item from this case.");
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<ForensicRequestDetail>(`/api/cases/${caseId}/forensic-requests`, {
        method: "POST",
        body: JSON.stringify({
          request_type: requestType,
          reason,
          instructions,
          evidence_ids: selected,
        }),
      });
      await onCreated(created);
    } catch (caught) {
      onError(caught instanceof ApiClientError ? caught.message : "The request was refused.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-white p-6">
      <h3 className="text-base font-semibold">Request examination</h3>
      <label className="mt-4 block text-sm">
        Request type
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2" value={requestType} onChange={(event) => setRequestType(event.target.value)}>
          {REQUEST_TYPES.map((value) => (
            <option key={value} value={value}>{forensicTypeLabel(value)}</option>
          ))}
        </select>
      </label>
      <fieldset className="mt-4">
        <legend className="text-sm">Evidence from this case</legend>
        <div className="mt-2 space-y-2">
          {evidence.length === 0 ? <p className="text-sm text-muted">No authorized evidence is available.</p> : null}
          {evidence.map((item) => (
            <label key={item.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(event) => {
                  setSelected((current) =>
                    event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                  );
                }}
              />
              <span>
                <span className="font-medium">{item.evidence_number}</span>
                <span className="block text-muted">{item.title} · {evidenceTypeLabel(item.evidence_type)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block text-sm">
        Reason
        <textarea className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} />
      </label>
      <label className="mt-4 block text-sm">
        Instructions
        <textarea className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} required minLength={10} />
      </label>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>Submit request</button>
        <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export function WorkQueueView() {
  const [items, setItems] = useState<ForensicRequestSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ items: ForensicRequestSummary[] }>("/api/forensics/work-queue")
      .then((data) => setItems(data.items))
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : "The work queue could not be loaded."));
  }, []);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold text-navy">Forensic work queue</h2>
        <p className="mt-1 text-sm text-muted">Requests assigned to you.</p>
      </header>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <ul className="space-y-3">
        {items.length === 0 ? <li className="text-sm text-muted">No assigned examinations are waiting.</li> : null}
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-line bg-white p-4">
            <p className="font-medium">{item.request_number}</p>
            <p className="text-sm">{forensicTypeLabel(item.request_type)}</p>
            <p className="text-sm text-muted">{item.case_number}</p>
            <p className="text-sm text-muted">{item.evidence_count} evidence items</p>
            <p className="text-sm">{forensicStatusLabel(item.status)}</p>
            <p className="text-sm text-muted">Requested {formatTimestamp(item.requested_at)}</p>
            <Link href={`/forensic-requests/${item.id}`} className="mt-3 inline-flex rounded-md border border-line px-3 py-2 text-sm">Open</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewQueueView() {
  const [items, setItems] = useState<ForensicRequestSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ items: ForensicRequestSummary[] }>("/api/forensics/reviews")
      .then((data) => setItems(data.items))
      .catch((caught) => setError(caught instanceof ApiClientError ? caught.message : "Reviews could not be loaded."));
  }, []);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold text-navy">Pending reviews</h2>
      </header>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Request</th>
              <th className="px-4 py-3 font-medium">Case</th>
              <th className="px-4 py-3 font-medium">Examiner</th>
              <th className="px-4 py-3 font-medium">Evidence</th>
              <th className="px-4 py-3 font-medium">Requested</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td className="px-4 py-6 text-muted" colSpan={7}>No examinations are waiting for review.</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className="px-4 py-3">{item.request_number}</td>
                <td className="px-4 py-3">{item.case_number}</td>
                <td className="px-4 py-3">{item.assigned_to_name ?? "Unassigned"}</td>
                <td className="px-4 py-3">{item.evidence_count}</td>
                <td className="px-4 py-3">{formatTimestamp(item.requested_at)}</td>
                <td className="px-4 py-3">{forensicStatusLabel(item.status)}</td>
                <td className="px-4 py-3"><Link href={`/forensic-requests/${item.id}`} className="text-navy underline">Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

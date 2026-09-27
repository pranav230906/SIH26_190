"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { DocumentClassificationBadge } from "@/components/document-badges";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch, apiFetchBlob, uploadWithProgress } from "@/lib/api";
import {
  documentClassificationLabel,
  evidenceStatusLabel,
  evidenceTypeLabel,
  formatDay,
  formatFileSize,
} from "@/lib/format";
import type { CaseDetail, EvidenceDetail, EvidenceListResponse, EvidenceSummary } from "@/lib/types";

const EVIDENCE_TYPES = [
  "CCTV_VIDEO",
  "AUDIO_RECORDING",
  "PHOTOGRAPH",
  "MOBILE_DUMP",
  "DISK_IMAGE",
  "DOCUMENT",
  "SCREENSHOT",
  "DIGITAL_FILE",
  "FORENSIC_IMAGE",
  "OTHER",
];
const CLASSIFICATIONS = ["INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"];
const STATUSES = ["RECEIVED", "VERIFIED", "SEALED", "ARCHIVED"];
const ALLOWED_FORMATS = "PDF, DOCX, DOC, XLSX, XLS, CSV, JPG, JPEG, PNG, TXT, MP4, WEBM, WAV";

export function EvidenceView() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { permissions } = usePermissions();
  const [caseRecord, setCaseRecord] = useState<CaseDetail | null>(null);
  const [evidence, setEvidence] = useState<EvidenceListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [classification, setClassification] = useState("");
  const [status, setStatus] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const canUpload = can(permissions, "EVIDENCE.UPLOAD") || can(permissions, "EVIDENCE.CREATE");
  const canDownload = can(permissions, "EVIDENCE.DOWNLOAD");

  const load = useCallback(async () => {
    setError(null);
    const caseData = await apiFetch<CaseDetail>(`/api/cases/${caseId}`);
    setCaseRecord(caseData);
    const search = new URLSearchParams({ page: "1", page_size: "50" });
    if (appliedQuery.trim()) search.set("q", appliedQuery.trim());
    if (evidenceType) search.set("evidence_type", evidenceType);
    if (classification) search.set("classification", classification);
    if (status) search.set("status", status);
    const list = await apiFetch<EvidenceListResponse>(`/api/cases/${caseId}/evidence?${search.toString()}`);
    setEvidence(list);
  }, [appliedQuery, caseId, classification, evidenceType, status]);

  useEffect(() => {
    let cancelled = false;
    load().catch((caught) => {
      if (!cancelled) setError(messageFrom(caught));
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-2">
            <Link href={`/cases/${caseId}`} className="hover:text-blue-600 transition-colors">Case {caseRecord?.case_number ?? "..."}</Link>
            <span>/</span>
            <span className="text-slate-900">Evidence Vault</span>
          </nav>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Case Evidence</h2>
        </div>
        {canUpload ? (
          <button type="button" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm flex items-center gap-2" onClick={() => setUploadOpen(true)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Lodge Evidence
          </button>
        ) : null}
      </header>
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}
      <form
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedQuery(query);
        }}
      >
        <label className="text-sm md:col-span-2">
          <span className="font-medium text-slate-700">Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Number, title, or filename" />
        </label>
        <Filter label="Type" value={evidenceType} onChange={setEvidenceType} options={EVIDENCE_TYPES} labelFor={evidenceTypeLabel} />
        <Filter label="Security" value={classification} onChange={setClassification} options={CLASSIFICATIONS} labelFor={documentClassificationLabel} />
        <Filter label="Status" value={status} onChange={setStatus} options={STATUSES} labelFor={evidenceStatusLabel} />
        <div className="flex items-end justify-end gap-3 md:col-span-5 border-t border-slate-100 pt-3 mt-1">
          <button
            type="button"
            className="rounded-md border border-transparent px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            onClick={() => {
              setQuery("");
              setAppliedQuery("");
              setEvidenceType("");
              setClassification("");
              setStatus("");
            }}
          >
            Clear Filters
          </button>
          <button type="submit" className="rounded-md bg-slate-900 hover:bg-slate-800 transition-colors px-5 py-2 text-sm font-medium text-white shadow-sm">
            Apply Search
          </button>
        </div>
      </form>
      {evidence === null ? (
        error ? null : <p className="text-sm text-slate-500 mt-4">Loading evidence vault...</p>
      ) : evidence.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 shadow-sm mt-4">No evidence matches your search criteria.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm mt-4">
          <table className="min-w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wider text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Evidence Item</th>
                <th className="px-6 py-4">Type & Security</th>
                <th className="px-6 py-4">Status & Integrity</th>
                <th className="px-6 py-4">Chain of Custody</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {evidence.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 max-w-[240px] truncate">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded bg-indigo-50 flex items-center justify-center text-indigo-500">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                      </div>
                      <div className="truncate">
                        <p className="font-semibold text-slate-900 truncate">{item.title}</p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{item.evidence_number}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 space-y-2">
                     <div><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{evidenceTypeLabel(item.evidence_type)}</span></div>
                     <div><DocumentClassificationBadge value={item.classification} /></div>
                  </td>
                  <td className="px-6 py-4">
                     <div><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.status === 'SEALED' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>{evidenceStatusLabel(item.status)}</span></div>
                     <p className="mt-1 font-mono text-[10px] text-slate-400" title={item.sha256_hash}>Hash: {item.sha256_hash.slice(0, 8)}…</p>
                  </td>
                  <td className="px-6 py-4">
                     <p className="text-sm font-medium text-slate-700">{item.created_by_name || "Case Vault"}</p>
                     <p className="text-xs text-slate-500">Lodged: {formatDay(item.created_at)}</p>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/evidence/${item.id}`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm">
                        Inspect
                      </Link>
                      {canDownload ? (
                        <button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm" onClick={() => downloadFile(`/api/evidence/${item.id}/download`, setError)}>
                          Download
                        </button>
                      ) : null}
                      <Link href={`/evidence/${item.id}#integrity`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm">Verify</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {uploadOpen && evidence ? (
        <UploadEvidence
          caseId={caseId}
          maxMb={evidence.max_upload_size_mb}
          onClose={() => setUploadOpen(false)}
          onUploaded={async (title, scanNotice) => {
            setUploadOpen(false);
            setNotice(scanNotice ? `${title} was stored. ${scanNotice}` : `${title} was stored as original evidence.`);
            await load();
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
  labelFor,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labelFor: (value: string) => string;
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      <span className="block mb-1.5">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{labelFor(option)}</option>
        ))}
      </select>
    </label>
  );
}

function UploadEvidence({
  caseId,
  maxMb,
  onClose,
  onUploaded,
  onError,
}: {
  caseId: string;
  maxMb: number;
  onClose: () => void;
  onUploaded: (title: string, notice: string | null) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] = useState("PHOTOGRAPH");
  const [classification, setClassification] = useState("INTERNAL");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileFacts = useMemo(() => (file ? `${file.name} · ${formatFileSize(file.size)} · ${file.type || "unknown type"}` : null), [file]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setProgress(0);
    const form = new FormData();
    form.set("file", file);
    form.set("title", title);
    form.set("evidence_type", evidenceType);
    form.set("classification", classification);
    if (description.trim()) form.set("description", description.trim());
    try {
      const created = await uploadWithProgress<EvidenceDetail>(`/api/cases/${caseId}/evidence`, form, setProgress);
      let noticeMessage = created.security_scan_message ?? null;
      await onUploaded(created.title, noticeMessage);
    } catch (caught) {
      onError(messageFrom(caught));
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-navy/40 p-4">
      <form onSubmit={submit} className="my-8 w-[min(100%,36rem)] space-y-4 rounded-lg border border-line bg-white p-6">
        <h3 className="text-lg font-semibold text-navy">Upload original evidence</h3>
        <p className="text-sm text-muted">Maximum file size {maxMb} MB. Allowed formats: {ALLOWED_FORMATS}. The original file cannot be replaced after upload.</p>
        <label className="block text-sm">
          File
          <input required type="file" className="mt-1 block w-full text-sm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {fileFacts ? <p className="text-sm text-navy">{fileFacts}</p> : null}
        <label className="block text-sm">
          Title
          <input required minLength={3} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
        </label>
        <label className="block text-sm">
          Evidence type
          <select value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
            {EVIDENCE_TYPES.map((option) => <option key={option} value={option}>{evidenceTypeLabel(option)}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Classification
          <select value={classification} onChange={(event) => setClassification(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
            {CLASSIFICATIONS.map((option) => <option key={option} value={option}>{documentClassificationLabel(option)}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} />
        </label>
        {progress !== null ? <p className="text-sm text-muted">Upload progress {progress}%</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>Upload evidence</button>
        </div>
      </form>
    </div>
  );
}

export async function downloadFile(path: string, onError: (message: string) => void) {
  try {
    const { blob, filename } = await apiFetchBlob(path);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "evidence";
    link.click();
    URL.revokeObjectURL(url);
  } catch (caught) {
    onError(messageFrom(caught));
  }
}

function messageFrom(caught: unknown): string {
  if (caught instanceof ApiClientError) return caught.message || "The evidence request could not be completed.";
  return "The evidence request could not be completed.";
}

export { messageFrom as evidenceMessage };

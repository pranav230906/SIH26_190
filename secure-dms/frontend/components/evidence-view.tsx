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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Evidence vault</p>
          <h2 className="mt-1 text-2xl font-semibold text-navy">{caseRecord?.case_number ?? "Case evidence"}</h2>
          <p className="mt-1 text-sm text-muted">{caseRecord?.title ?? "Loading case"}</p>
        </div>
        {canUpload ? (
          <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => setUploadOpen(true)}>
            Upload evidence
          </button>
        ) : null}
      </header>
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}
      <form
        className="grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedQuery(query);
        }}
      >
        <label className="text-sm md:col-span-2">
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" placeholder="Number, title, or filename" />
        </label>
        <Filter label="Evidence type" value={evidenceType} onChange={setEvidenceType} options={EVIDENCE_TYPES} labelFor={evidenceTypeLabel} />
        <Filter label="Classification" value={classification} onChange={setClassification} options={CLASSIFICATIONS} labelFor={documentClassificationLabel} />
        <Filter label="Status" value={status} onChange={setStatus} options={STATUSES} labelFor={evidenceStatusLabel} />
        <div className="flex items-end gap-2 md:col-span-5">
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">Search</button>
          <button
            type="button"
            className="rounded-md border border-line px-3 py-2 text-sm"
            onClick={() => {
              setQuery("");
              setAppliedQuery("");
              setEvidenceType("");
              setClassification("");
              setStatus("");
            }}
          >
            Clear filters
          </button>
        </div>
      </form>
      {evidence === null ? (
        error ? null : <p className="text-sm text-muted">Loading evidence</p>
      ) : evidence.items.length === 0 ? (
        <p className="rounded-lg border border-line bg-white px-4 py-6 text-sm text-muted">No evidence matches these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Evidence number</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Classification</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Hash</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {evidence.items.map((item) => (
                <tr key={item.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium text-navy">{item.evidence_number}</td>
                  <td className="px-4 py-3">{item.title}</td>
                  <td className="px-4 py-3">{evidenceTypeLabel(item.evidence_type)}</td>
                  <td className="px-4 py-3"><DocumentClassificationBadge value={item.classification} /></td>
                  <td className="px-4 py-3">{evidenceStatusLabel(item.status)}</td>
                  <td className="px-4 py-3 font-mono text-xs" title={item.sha256_hash}>{item.sha256_hash.slice(0, 12)}…</td>
                  <td className="px-4 py-3">{formatDay(item.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/evidence/${item.id}`} className="rounded-md border border-line px-2 py-1 text-xs">View</Link>
                      {canDownload ? (
                        <button type="button" className="rounded-md border border-line px-2 py-1 text-xs" onClick={() => downloadFile(`/api/evidence/${item.id}/download`, setError)}>
                          Download
                        </button>
                      ) : null}
                      <Link href={`/evidence/${item.id}#integrity`} className="rounded-md border border-line px-2 py-1 text-xs">Verify integrity</Link>
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
    <label className="text-sm">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { DocumentClassificationBadge, DocumentStatusBadge, DocumentTypeBadge } from "@/components/document-badges";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch, apiFetchBlob, uploadWithProgress } from "@/lib/api";
import {
  documentClassificationLabel,
  documentStatusLabel,
  documentTypeLabel,
  formatDay,
  formatFileSize,
} from "@/lib/format";
import type { CaseDetail, DocumentDetail, DocumentListResponse, DocumentSummary } from "@/lib/types";

const DOCUMENT_TYPES = [
  "FIR",
  "POLICE_REPORT",
  "INVESTIGATION_RECORD",
  "WITNESS_STATEMENT",
  "CHARGE_SHEET",
  "COURT_FILING",
  "EVIDENCE_RECORD",
  "FORENSIC_REPORT",
  "LEGAL_NOTICE",
  "JUDGMENT",
  "CASE_DIARY",
  "OTHER",
];

const CLASSIFICATIONS = ["INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"];
const STATUSES = ["DRAFT", "UNDER_REVIEW", "APPROVED", "SEALED", "ARCHIVED"];
const ALLOWED_FORMATS = "PDF, DOCX, DOC, XLSX, XLS, CSV, JPG, JPEG, PNG, TXT";

const STATUS_ACTION: Record<string, string> = {
  UNDER_REVIEW: "Submit for review",
  DRAFT: "Return to draft",
  APPROVED: "Approve",
  SEALED: "Seal",
  ARCHIVED: "Archive",
};

export function DocumentsView() {
  const params = useParams<{ id: string }>();
  const caseId = params.id;
  const { permissions } = usePermissions();
  const [caseRecord, setCaseRecord] = useState<CaseDetail | null>(null);
  const [documents, setDocuments] = useState<DocumentListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [classification, setClassification] = useState("");
  const [status, setStatus] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const canUpload = can(permissions, "DOCUMENT.UPLOAD") || can(permissions, "DOCUMENT.CREATE");
  const canDownload = can(permissions, "DOCUMENT.DOWNLOAD");
  const canUpdate = can(permissions, "DOCUMENT.UPDATE");
  const canRequest = can(permissions, "ACCESS_REQUEST.CREATE");

  const load = useCallback(async () => {
    setError(null);
    const caseData = await apiFetch<CaseDetail>(`/api/cases/${caseId}`);
    setCaseRecord(caseData);
    const search = new URLSearchParams({ page: "1", page_size: "50" });
    if (appliedQuery.trim()) {
      search.set("q", appliedQuery.trim());
    }
    if (documentType) {
      search.set("document_type", documentType);
    }
    if (classification) {
      search.set("classification", classification);
    }
    if (status) {
      search.set("status", status);
    }
    try {
      const list = await apiFetch<DocumentListResponse>(`/api/cases/${caseId}/documents?${search.toString()}`);
      setDocuments(list);
      setRestricted(false);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 403) {
        setDocuments(null);
        setRestricted(true);
        return;
      }
      throw caught;
    }
  }, [appliedQuery, caseId, classification, documentType, status]);

  useEffect(() => {
    let cancelled = false;
    load().catch((caught) => {
      if (!cancelled) {
        setError(messageFrom(caught));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function refresh() {
    try {
      await load();
    } catch (caught) {
      setError(messageFrom(caught));
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Documents</p>
          <h2 className="mt-1 text-2xl font-semibold text-navy">{caseRecord?.case_number ?? "Case documents"}</h2>
          <p className="mt-1 text-sm text-muted">{caseRecord?.title ?? "Loading case"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRequest && !restricted ? (
            <button type="button" className="rounded-md border border-line bg-white px-3 py-2 text-sm" onClick={() => setRequestOpen(true)}>
              Request access
            </button>
          ) : null}
          {canUpload && !restricted ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => setUploadOpen(true)}>
              Upload document
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-line bg-white px-4 py-3 text-sm text-navy">{notice}</p>
      ) : null}

      {restricted ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <p className="text-sm font-medium">Your access: RESTRICTED</p>
          <p className="mt-2 text-sm text-muted">You can open this case, and document records are not available to this role.</p>
          {canRequest ? (
            <button type="button" className="mt-4 rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => setRequestOpen(true)}>
              Request access
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <form
            className="grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedQuery(query);
            }}
          >
            <label className="text-sm md:col-span-2">
              Search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2"
                placeholder="Number, title, or filename"
              />
            </label>
            <Select label="Document type" value={documentType} onChange={setDocumentType} options={DOCUMENT_TYPES} labelFor={documentTypeLabel} />
            <Select label="Classification" value={classification} onChange={setClassification} options={CLASSIFICATIONS} labelFor={documentClassificationLabel} />
            <Select label="Status" value={status} onChange={setStatus} options={STATUSES} labelFor={documentStatusLabel} />
            <div className="flex items-end gap-2 md:col-span-5">
              <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
                Search
              </button>
              <button
                type="button"
                className="rounded-md border border-line px-3 py-2 text-sm"
                onClick={() => {
                  setQuery("");
                  setAppliedQuery("");
                  setDocumentType("");
                  setClassification("");
                  setStatus("");
                }}
              >
                Clear filters
              </button>
            </div>
          </form>

          {documents === null ? (
            error ? null : <p className="text-sm text-muted">Loading documents</p>
          ) : documents.items.length === 0 ? (
            <p className="rounded-lg border border-line bg-white px-4 py-6 text-sm text-muted">No documents match these filters.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Document</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Classification</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Created by</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.items.map((item) => (
                    <DocumentRow
                      key={item.id}
                      item={item}
                      canDownload={canDownload}
                      canUpdate={canUpdate}
                      onChanged={refresh}
                      onError={setError}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {uploadOpen && documents ? (
        <UploadDialog
          caseId={caseId}
          maxMb={documents.max_upload_size_mb}
          onClose={() => setUploadOpen(false)}
          onUploaded={async (title, notice) => {
            setUploadOpen(false);
            setNotice(notice ? `${title} was uploaded. ${notice}` : `${title} was uploaded.`);
            await refresh();
          }}
          onError={setError}
        />
      ) : null}
      {requestOpen ? (
        <RequestAccessDialog
          caseId={caseId}
          onClose={() => setRequestOpen(false)}
          onDone={() => {
            setRequestOpen(false);
            setNotice("Access request submitted.");
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function DocumentRow({
  item,
  canDownload,
  canUpdate,
  onChanged,
  onError,
}: {
  item: DocumentSummary;
  canDownload: boolean;
  canUpdate: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const locked = item.status === "SEALED" || item.status === "ARCHIVED";
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3">
        <p className="font-medium text-navy">{item.document_number}</p>
        <p className="mt-1">{item.title}</p>
      </td>
      <td className="px-4 py-3">
        <DocumentTypeBadge value={item.document_type} />
      </td>
      <td className="px-4 py-3">
        <DocumentClassificationBadge value={item.classification} />
      </td>
      <td className="px-4 py-3">
        <DocumentStatusBadge value={item.status} />
      </td>
      <td className="px-4 py-3">{item.created_by_name}</td>
      <td className="px-4 py-3">{formatDay(item.updated_at)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Link href={`/documents/${item.id}`} className="rounded-md border border-line px-2 py-1 text-xs">
            View
          </Link>
          {canDownload ? (
            <button type="button" className="rounded-md border border-line px-2 py-1 text-xs" onClick={() => downloadDocument(item.id, onError)}>
              Download
            </button>
          ) : null}
          {canUpdate && !locked ? (
            <Link href={`/documents/${item.id}?edit=1`} className="rounded-md border border-line px-2 py-1 text-xs">
              Edit metadata
            </Link>
          ) : null}
          {item.allowed_status_transitions.map((target) => (
            <button
              key={target}
              type="button"
              className="rounded-md border border-line px-2 py-1 text-xs"
              onClick={() => changeStatus(item.id, target, onChanged, onError)}
            >
              {STATUS_ACTION[target] ?? target}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}

function Select({
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
          <option key={option} value={option}>
            {labelFor(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function UploadDialog({
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
  const [documentType, setDocumentType] = useState("FIR");
  const [classification, setClassification] = useState("INTERNAL");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const fileFacts = useMemo(() => {
    if (!file) {
      return null;
    }
    return `${file.name} · ${formatFileSize(file.size)} · ${file.type || "unknown type"}`;
  }, [file]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) {
      return;
    }
    setBusy(true);
    setProgress(0);
    const form = new FormData();
    form.set("file", file);
    form.set("title", title);
    form.set("document_type", documentType);
    form.set("classification", classification);
    if (description.trim()) {
      form.set("description", description.trim());
    }
    try {
      const created = await uploadWithProgress<DocumentDetail>(`/api/cases/${caseId}/documents`, form, setProgress);
      await onUploaded(created.title, created.search_notice ?? null);
    } catch (caught) {
      onError(messageFrom(caught));
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-navy/40 p-4">
      <form onSubmit={submit} className="my-8 w-[min(100%,36rem)] space-y-4 rounded-lg border border-line bg-white p-6 text-ink">
        <h3 className="text-lg font-semibold text-navy">Upload document</h3>
        <p className="text-sm text-muted">
          Maximum file size {maxMb} MB. Allowed formats: {ALLOWED_FORMATS}.
        </p>
        <label className="block text-sm">
          File
          <input
            required
            type="file"
            className="mt-1 block w-full text-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {fileFacts ? <p className="text-sm text-navy">{fileFacts}</p> : null}
        <label className="block text-sm">
          Title
          <input required minLength={3} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
        </label>
        <label className="block text-sm">
          Document type
          <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
            {DOCUMENT_TYPES.map((option) => (
              <option key={option} value={option}>
                {documentTypeLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Classification
          <select value={classification} onChange={(event) => setClassification(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
            {CLASSIFICATIONS.map((option) => (
              <option key={option} value={option}>
                {documentClassificationLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} />
        </label>
        {progress !== null ? <p className="text-sm text-muted">Upload progress {progress}%</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>
            Upload document
          </button>
        </div>
      </form>
    </div>
  );
}

function RequestAccessDialog({
  caseId,
  onClose,
  onDone,
  onError,
}: {
  caseId: string;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/cases/${caseId}/access-requests`, {
        method: "POST",
        body: JSON.stringify({
          resource_type: "DOCUMENT",
          requested_action: "READ",
          justification,
        }),
      });
      onDone();
    } catch (caught) {
      onError(messageFrom(caught));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-navy/40 p-4">
      <form onSubmit={submit} className="mt-16 w-[min(100%,32rem)] space-y-4 rounded-lg border border-line bg-white p-6">
        <h3 className="text-lg font-semibold text-navy">Request access</h3>
        <label className="block text-sm">
          Reason
          <textarea required minLength={10} value={justification} onChange={(event) => setJustification(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={4} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>
            Submit request
          </button>
        </div>
      </form>
    </div>
  );
}

async function downloadDocument(documentId: string, onError: (message: string) => void) {
  try {
    const { blob, filename } = await apiFetchBlob(`/api/documents/${documentId}/download`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "document";
    link.click();
    URL.revokeObjectURL(url);
  } catch (caught) {
    onError(messageFrom(caught));
  }
}

async function changeStatus(
  documentId: string,
  status: string,
  onChanged: () => Promise<void>,
  onError: (message: string) => void,
) {
  try {
    await apiFetch(`/api/documents/${documentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await onChanged();
  } catch (caught) {
    onError(messageFrom(caught));
  }
}

function messageFrom(caught: unknown): string {
  if (caught instanceof ApiClientError) {
    return caught.message || "The document request could not be completed.";
  }
  return "The document request could not be completed.";
}

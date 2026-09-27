"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { DocumentClassificationBadge, DocumentStatusBadge, DocumentTypeBadge } from "@/components/document-badges";
import { can, usePermissions, useSession } from "@/components/session-context";
import { ApiClientError, apiFetch, apiFetchBlob, uploadWithProgress } from "@/lib/api";
import {
  documentClassificationLabel,
  documentStatusLabel,
  creatableDocumentTypes,
  documentTypeLabel,
  formatDay,
  formatFileSize,
  SEARCH_DOCUMENT_TYPES,
} from "@/lib/format";
import type { CaseDetail, DocumentDetail, DocumentListResponse, DocumentSummary } from "@/lib/types";

const DOCUMENT_TYPES = SEARCH_DOCUMENT_TYPES;

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
  const session = useSession();
  const { permissions } = usePermissions();
  const uploadTypes = creatableDocumentTypes(session.role.name);
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
      <header className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div>
          <nav aria-label="Breadcrumb" className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-2">
            <Link href={`/cases/${caseId}`} className="hover:text-blue-600 transition-colors">Case {caseRecord?.case_number ?? "..."}</Link>
            <span>/</span>
            <span className="text-slate-900">Documents</span>
          </nav>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Case Documents</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          {canRequest && !restricted ? (
            <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={() => setRequestOpen(true)}>
              Request Access
            </button>
          ) : null}
          {canUpload && !restricted ? (
            <button type="button" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm flex items-center gap-2" onClick={() => setUploadOpen(true)}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Upload Document
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 shadow-sm">{notice}</p>
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
            className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedQuery(query);
            }}
          >
            <label className="text-sm md:col-span-2">
              <span className="font-medium text-slate-700">Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Number, title, or filename"
              />
            </label>
            <Select label="Type" value={documentType} onChange={setDocumentType} options={DOCUMENT_TYPES} labelFor={documentTypeLabel} />
            <Select label="Security" value={classification} onChange={setClassification} options={CLASSIFICATIONS} labelFor={documentClassificationLabel} />
            <Select label="Status" value={status} onChange={setStatus} options={STATUSES} labelFor={documentStatusLabel} />
            <div className="flex items-end justify-end gap-3 md:col-span-5 border-t border-slate-100 pt-3 mt-1">
              <button
                type="button"
                className="rounded-md border border-transparent px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => {
                  setQuery("");
                  setAppliedQuery("");
                  setDocumentType("");
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

          {documents === null ? (
            error ? null : <p className="text-sm text-slate-500 mt-4">Loading documents...</p>
          ) : documents.items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 shadow-sm mt-4">No documents match your search criteria.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm mt-4">
              <table className="min-w-full text-left text-sm whitespace-nowrap">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wider text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="px-6 py-4">Document Details</th>
                    <th className="px-6 py-4">Type & Security</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Author</th>
                    <th className="px-6 py-4">Updated</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
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
          types={uploadTypes}
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
    <tr className="hover:bg-slate-50 transition-colors group">
      <td className="px-6 py-4 max-w-[240px] truncate">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <div className="truncate">
            <p className="font-semibold text-slate-900 truncate">{item.title}</p>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{item.document_number}</p>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 space-y-2">
        <div><DocumentTypeBadge value={item.document_type} /></div>
        <div><DocumentClassificationBadge value={item.classification} /></div>
      </td>
      <td className="px-6 py-4">
        <DocumentStatusBadge value={item.status} />
      </td>
      <td className="px-6 py-4 text-slate-700">{item.created_by_name}</td>
      <td className="px-6 py-4 text-slate-500 text-sm">{formatDay(item.updated_at)}</td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link href={`/documents/${item.id}`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm">
            Open
          </Link>
          {canDownload ? (
            <button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm" onClick={() => downloadDocument(item.id, onError)}>
              Download
            </button>
          ) : null}
          {canUpdate && !locked ? (
            <Link href={`/documents/${item.id}?edit=1`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm">
              Edit
            </Link>
          ) : null}
          {item.allowed_status_transitions.map((target) => (
            <button
              key={target}
              type="button"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 shadow-sm"
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
    <label className="text-sm font-medium text-slate-700">
      <span className="block mb-1.5">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
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
  types,
  onClose,
  onUploaded,
  onError,
}: {
  caseId: string;
  maxMb: number;
  types: string[];
  onClose: () => void;
  onUploaded: (title: string, notice: string | null) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState(types[0] ?? "FIR");
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
      let noticeMessage = created.search_notice ?? "";
      if (created.security_scan_message) {
          noticeMessage = (noticeMessage ? noticeMessage + " " : "") + created.security_scan_message;
      }
      await onUploaded(created.title, noticeMessage || null);
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
            {types.map((option) => (
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

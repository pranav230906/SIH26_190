"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AuditTimeline } from "@/components/audit-timeline";
import { DocumentClassificationBadge, DocumentStatusBadge, DocumentTypeBadge } from "@/components/document-badges";
import { DocumentRevisions } from "@/components/document-revisions";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch, apiFetchBlob } from "@/lib/api";
import {
  documentClassificationLabel,
  documentStatusLabel,
  documentTypeLabel,
  formatDay,
  formatFileSize,
  formatTimestamp,
} from "@/lib/format";
import type { DirectoryUser, DocumentDetail, OcrStatus, PageText } from "@/lib/types";

const CLASSIFICATIONS = ["INTERNAL", "CONFIDENTIAL", "HIGHLY_CONFIDENTIAL", "RESTRICTED"];
const STATUS_ACTION: Record<string, string> = {
  UNDER_REVIEW: "Submit for review",
  DRAFT: "Return to draft",
  APPROVED: "Approve",
  SEALED: "Seal",
  ARCHIVED: "Archive",
};

export function DocumentDetailView() {
  const params = useParams<{ documentId: string }>();
  const search = useSearchParams();
  const { permissions } = usePermissions();
  const [record, setRecord] = useState<DocumentDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(search.get("edit") === "1");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferToUserId, setTransferToUserId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [transferBusy, setTransferBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ocr, setOcr] = useState<OcrStatus | null>(null);
  const [pageText, setPageText] = useState<PageText | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);

  const canDownload = can(permissions, "DOCUMENT.DOWNLOAD");
  const canUpdate = can(permissions, "DOCUMENT.UPDATE");
  const canRequest = can(permissions, "ACCESS_REQUEST.CREATE");

  useEffect(() => {
    if (transferOpen && directoryUsers.length === 0) {
      apiFetch<{ items: DirectoryUser[] }>("/api/users/directory")
        .then((res) => setDirectoryUsers(res.items))
        .catch(() => {});
    }
  }, [transferOpen, directoryUsers.length]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DocumentDetail>(`/api/documents/${params.documentId}`)
      .then((data) => {
        if (!cancelled) {
          setRecord(data);
        }
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        if (caught instanceof ApiClientError && caught.status === 404) {
          setMissing(true);
          return;
        }
        setError(caught instanceof ApiClientError ? caught.message : "The document could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [params.documentId]);

  useEffect(() => {
    apiFetch<OcrStatus>(`/api/documents/${params.documentId}/ocr-status`)
      .then(setOcr)
      .catch(() => setOcr(null));
  }, [params.documentId]);

  useEffect(() => {
    const page = search.get("page");
    if (!page) {
      setPageText(null);
      return;
    }
    const version = search.get("version");
    const query = new URLSearchParams({ page });
    if (version) query.set("version_id", version);
    apiFetch<PageText>(`/api/documents/${params.documentId}/text?${query.toString()}`)
      .then(setPageText)
      .catch(() => setPageText(null));
  }, [params.documentId, search]);

  useEffect(() => {
    if (!record) {
      return;
    }
    const previewable = record.mime_type === "application/pdf" || record.mime_type === "image/jpeg" || record.mime_type === "image/png";
    if (!previewable) {
      setPreviewNote("Preview not available. Download the document to view it.");
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    apiFetchBlob(`/api/documents/${record.id}/preview`)
      .then(({ blob }) => {
        const next = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        url = next;
        setPreviewUrl(next);
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewNote("Preview not available. Download the document to view it.");
        }
      });
    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [record]);

  async function saveMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record) {
      return;
    }
    const form = new FormData(event.currentTarget);
    try {
      const updated = await apiFetch<DocumentDetail>(`/api/documents/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          classification: String(form.get("classification") ?? record.classification),
        }),
      });
      setRecord(updated);
      setEditing(false);
      setNotice("Metadata updated.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The document could not be updated.");
    }
  }

  async function changeStatus(status: string) {
    if (!record) {
      return;
    }
    try {
      const updated = await apiFetch<DocumentDetail>(`/api/documents/${record.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setRecord(updated);
      setNotice("Status updated.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The status could not be changed.");
    }
  }

  async function rebuildIndex(action: "ocr" | "reindex") {
    if (!record || indexBusy) {
      return;
    }
    setIndexBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<OcrStatus>(`/api/documents/${record.id}/${action}`, { method: "POST" });
      setOcr(updated);
      setNotice(updated.error ? updated.error : "Search index updated.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The document could not be indexed.");
    } finally {
      setIndexBusy(false);
    }
  }

  async function download() {
    if (!record) {
      return;
    }
    try {
      const { blob, filename } = await apiFetchBlob(`/api/documents/${record.id}/download`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || record.original_filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The download was refused.");
    }
  }

  async function submitTransfer(event: React.FormEvent) {
    event.preventDefault();
    if (!transferToUserId) return;
    setTransferBusy(true);
    try {
      const updated = await apiFetch<DocumentDetail>(`/api/documents/${params.documentId}/transfer-custody`, {
        method: "POST",
        body: JSON.stringify({
          to_user_id: transferToUserId,
          reason: transferReason,
        }),
      });
      setRecord(updated);
      setTransferOpen(false);
      setNotice("Document custody transferred successfully.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Custody transfer failed.");
    } finally {
      setTransferBusy(false);
    }
  }

  if (missing) {
    return <p className="text-sm text-muted">Document not found.</p>;
  }
  if (!record) {
    return <p className="text-sm text-muted">{error ?? "Loading document"}</p>;
  }

  const locked = record.status === "SEALED" || record.status === "ARCHIVED";

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500 mb-2">
          <Link href={`/cases/${record.case_id}`} className="hover:text-blue-600 transition-colors">Case {record.case_number}</Link>
          <span>/</span>
          <Link href={`/cases/${record.case_id}/documents`} className="hover:text-blue-600 transition-colors">Documents</Link>
          <span>/</span>
          <span className="text-slate-900">{record.document_number}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{record.title}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <DocumentStatusBadge value={record.status} />
              <DocumentClassificationBadge value={record.classification} />
              <DocumentTypeBadge value={record.document_type} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href="#document-preview" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              View Preview
            </a>
            {canDownload ? (
              <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={download}>
                Download Official
              </button>
            ) : null}
            {canUpdate && !locked ? (
              <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={() => setEditing((current) => !current)}>
                Edit Details
              </button>
            ) : null}
            {record.allowed_status_transitions.map((target) => (
              <button key={target} type="button" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => changeStatus(target)}>
                {STATUS_ACTION[target] ?? documentStatusLabel(target)}
              </button>
            ))}
            {record.allowed_actions?.includes("TRANSFER") ? (
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
                onClick={() => {
                  setTransferReason("");
                  setTransferToUserId("");
                  setTransferOpen(true);
                }}
              >
                Transfer Custody
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Content & History */}
        <div className="lg:col-span-2 space-y-6">
          <section id="document-preview" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Document Preview</h3>
            {pageText ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-700">Page {pageText.page_number}</p>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-900 font-mono leading-relaxed">{pageText.text}</p>
              </div>
            ) : null}
            {previewUrl && record.mime_type === "application/pdf" ? (
              <iframe title="Document preview" src={search.get("page") ? `${previewUrl}#page=${search.get("page")}` : previewUrl} className="mt-4 h-[42rem] w-full rounded-lg border border-slate-200 bg-slate-100" />
            ) : null}
            {previewUrl && record.mime_type !== "application/pdf" ? (
              <img alt="" src={previewUrl} className="mt-4 max-h-[42rem] rounded-lg border border-slate-200 bg-slate-100 object-contain w-full" />
            ) : null}
            {previewNote ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 flex gap-3 text-sm text-amber-800">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <p>{previewNote}</p>
              </div>
            ) : null}
          </section>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
             <DocumentRevisions documentId={record.id} locked={locked} />
          </div>

          <AuditTimeline title="Audit History" documentId={record.id} />
        </div>

        {/* RIGHT COLUMN: Metadata & Settings */}
        <div className="lg:col-span-1 space-y-6">
          
          {editing ? (
            <form onSubmit={saveMetadata} className="space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-blue-900 uppercase tracking-wider">Edit Metadata</h3>
              <label className="block text-sm font-medium text-slate-700">
                Title
                <input name="title" required minLength={3} maxLength={200} defaultValue={record.title} className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 focus:ring-blue-500 focus:border-blue-500" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Classification
                <select name="classification" defaultValue={record.classification} className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 focus:ring-blue-500 focus:border-blue-500">
                  {CLASSIFICATIONS.map((option) => (
                    <option key={option} value={option}>
                      {documentClassificationLabel(option)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Description
                <textarea name="description" defaultValue={record.description ?? ""} className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 focus:ring-blue-500 focus:border-blue-500" rows={4} />
              </label>
              <div className="flex gap-2">
                <button type="submit" className="rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow-sm">
                  Save Changes
                </button>
                <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-4">Metadata</h3>
            <dl className="grid gap-y-4 gap-x-4 sm:grid-cols-2">
              <Info label="Document Type" value={documentTypeLabel(record.document_type)} />
              <Info label="File Size" value={formatFileSize(record.file_size)} />
              <Info label="File Type" value={record.mime_type.split('/').pop()?.toUpperCase() || record.mime_type} />
              <Info label="Current Version" value={record.official_version_label ?? "v1.0"} />
              <div className="sm:col-span-2 pt-2 border-t border-slate-100"></div>
              <Info label="Created By" value={record.created_by_name} />
              <Info label="Custodian" value={record.custodian_name || record.created_by_name} />
              <Info label="Department" value={record.owner_department_name || record.owner_department_code || "N/A"} />
              <Info label="Approved By" value={record.approved_by_name ?? "Not Approved"} />
              <div className="sm:col-span-2 pt-2 border-t border-slate-100"></div>
              <Info label="Created" value={formatDay(record.created_at)} />
              <Info label="Updated" value={formatDay(record.updated_at)} />
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-3">Description</h3>
            <p className="text-sm text-slate-700 leading-relaxed">{record.description || "No description provided."}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase">Intelligence & Search</h3>
              {ocr && ocr.ocr_status === "COMPLETED" && (
                <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
              )}
            </div>
            {ocr ? (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="flex justify-between text-slate-700 mb-1">
                    <span>{ocrLabel(ocr.ocr_status)}</span>
                    <span className="font-mono">{ocr.pages_processed} / {ocr.total_pages}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                    <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${Math.max(5, (ocr.pages_processed / Math.max(1, ocr.total_pages)) * 100)}%` }}></div>
                  </div>
                </div>
                {ocr.extraction_method ? <p className="text-slate-500 text-xs">Method: {ocr.extraction_method.replaceAll("_", " ")}</p> : null}
                {ocr.error ? <p className="text-red-600 text-xs">{ocr.error}</p> : null}
                
                <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
                  <div>
                    <p className="text-xs text-slate-500">Lexical Index</p>
                    <p className="font-medium text-slate-900">{ocrLabel(ocr.lexical_status)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Semantic Vector</p>
                    <p className="font-medium text-slate-900">{ocrLabel(ocr.semantic_status)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Index status is not available.</p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" disabled={indexBusy} className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm" onClick={() => rebuildIndex("reindex")}>
                Reindex Search
              </button>
              <button type="button" disabled={indexBusy} className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm" onClick={() => rebuildIndex("ocr")}>
                Force OCR Run
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-3">Integrity Chain</h3>
            <p className="text-xs text-slate-500 mb-1">Algorithm: {record.hash_algorithm}</p>
            <div className="bg-slate-50 border border-slate-200 rounded p-2 overflow-hidden">
               <p className="break-all font-mono text-[10px] text-slate-600">{record.file_hash}</p>
            </div>
          </section>
          
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-3">Access Controls</h3>
            <div className="flex items-center gap-2 text-sm text-green-700 mb-4 bg-green-50 p-2 rounded border border-green-200">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Your access: AUTHORIZED
            </div>
            {!canDownload && canRequest ? (
              <button type="button" className="w-full rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={() => setRequestOpen(true)}>
                Request Elevate Access
              </button>
            ) : null}
          </section>

        </div>
      </div>



      {requestOpen ? (
        <RequestDownload
          record={record}
          onClose={() => setRequestOpen(false)}
          onDone={() => {
            setRequestOpen(false);
            setNotice("Access request submitted.");
          }}
          onError={setError}
        />
      ) : null}

      {transferOpen ? (
        <div className="fixed inset-0 z-20 flex items-start justify-center bg-navy/40 p-4">
          <form onSubmit={submitTransfer} className="mt-16 w-[min(100%,32rem)] space-y-4 rounded-lg border border-line bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-navy">Transfer Document Custody</h3>
            <p className="text-xs text-muted">
              Transfer custody of this document to another department officer or judicial official.
            </p>
            <label className="block text-sm">
              <span className="font-medium text-navy">New Custodian</span>
              <select
                required
                value={transferToUserId}
                onChange={(e) => setTransferToUserId(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              >
                <option value="">Select recipient...</option>
                {directoryUsers
                  .filter((u) => u.id !== record.custodian_user_id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.username}) · {u.role_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-navy">Reason for Transfer</span>
              <textarea
                required
                minLength={5}
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                placeholder="e.g. Forwarding report to prosecutor for review"
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                rows={3}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-md border border-line px-3 py-2 text-sm hover:bg-line/20"
                onClick={() => setTransferOpen(false)}
                disabled={transferBusy}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={transferBusy || !transferToUserId}
                className="rounded-md bg-navy px-3 py-2 text-sm text-white hover:bg-navy/90 disabled:opacity-50"
              >
                {transferBusy ? "Transferring..." : "Confirm Transfer"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900 truncate">{value}</dd>
    </div>
  );
}

function RequestDownload({
  record,
  onClose,
  onDone,
  onError,
}: {
  record: DocumentDetail;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [justification, setJustification] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiFetch(`/api/cases/${record.case_id}/access-requests`, {
        method: "POST",
        body: JSON.stringify({
          resource_type: "DOCUMENT",
          resource_id: record.id,
          requested_action: "DOWNLOAD",
          justification,
        }),
      });
      onDone();
    } catch (caught) {
      onError(caught instanceof ApiClientError ? caught.message : "The request could not be submitted.");
    }
  }
  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-navy/40 p-4">
      <form onSubmit={submit} className="mt-16 w-[min(100%,32rem)] space-y-4 rounded-lg border border-line bg-white p-6">
        <h3 className="text-lg font-semibold">Request access</h3>
        <label className="block text-sm">
          Reason
          <textarea required minLength={10} value={justification} onChange={(event) => setJustification(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={4} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
            Submit request
          </button>
        </div>
      </form>
    </div>
  );
}

function ocrLabel(status: string): string {
  if (status === "COMPLETED") return "Completed";
  if (status === "PROCESSING") return "Processing";
  if (status === "FAILED") return "Failed";
  return "Pending";
}

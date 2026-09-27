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
      <header className="rounded-lg border border-line bg-white p-6">
        <p className="text-sm text-muted">{record.document_number}</p>
        <h2 className="mt-1 text-2xl font-semibold text-navy">{record.title}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <DocumentStatusBadge value={record.status} />
          <DocumentClassificationBadge value={record.classification} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="#document-preview" className="rounded-md border border-line px-3 py-2 text-sm">
            View
          </a>
          {canDownload ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={download}>
              Download official
            </button>
          ) : null}
          {canUpdate && !locked ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => setEditing((current) => !current)}>
              Edit
            </button>
          ) : null}
          {record.allowed_status_transitions.map((target) => (
            <button key={target} type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => changeStatus(target)}>
              {STATUS_ACTION[target] ?? documentStatusLabel(target)}
            </button>
          ))}
          {record.allowed_actions?.includes("TRANSFER") ? (
            <button
              type="button"
              className="rounded-md border border-line px-3 py-2 text-sm"
              onClick={() => {
                setTransferReason("");
                setTransferToUserId("");
                setTransferOpen(true);
              }}
            >
              Transfer custody
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}

      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Document information</h3>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Document type" value={<DocumentTypeBadge value={record.document_type} />} />
          <Info label="Case" value={<Link className="text-navy underline" href={`/cases/${record.case_id}`}>{record.case_number}</Link>} />
          <Info label="Owner department" value={record.owner_department_name || record.owner_department_code || "Police Department"} />
          <Info label="Created by" value={record.created_by_name} />
          <Info label="Current custodian" value={record.custodian_name || record.created_by_name} />
          <Info label="Created date" value={formatTimestamp(record.created_at)} />
          <Info label="Updated date" value={formatTimestamp(record.updated_at)} />
          <Info label="File type" value={record.mime_type} />
          <Info label="File size" value={formatFileSize(record.file_size)} />
          <Info label="Approved by" value={record.approved_by_name ?? "Not approved"} />
          <Info label="Official version" value={record.official_version_label ?? "None yet"} />
        </dl>
      </section>

      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">OCR status</h3>
        {ocr ? (
          <div className="mt-3 space-y-2 text-sm">
            <p>
              {ocrLabel(ocr.ocr_status)} {ocr.pages_processed} / {ocr.total_pages} pages
            </p>
            {ocr.extraction_method ? <p className="text-muted">{ocr.extraction_method.replaceAll("_", " ")}</p> : null}
            {ocr.error ? <p className="text-danger">{ocr.error}</p> : null}
            <div className="mt-4">
              <h4 className="font-medium">Search index</h4>
              <p className="mt-1">Lexical: {ocr.lexical_status}</p>
              <p>Semantic: {ocr.semantic_status}</p>
              <p>OCR: {ocr.ocr_status}</p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Index status is not available.</p>
        )}
        <button type="button" disabled={indexBusy} className="mt-4 rounded-md border border-line px-3 py-2 text-sm" onClick={() => rebuildIndex("reindex")}>
          Reindex
        </button>
        <button type="button" disabled={indexBusy} className="ml-2 mt-4 rounded-md border border-line px-3 py-2 text-sm" onClick={() => rebuildIndex("ocr")}>
          Run OCR
        </button>
      </section>

      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Description</h3>
        <p className="mt-3 text-sm">{record.description || "No description."}</p>
      </section>

      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Integrity hash</h3>
        <p className="mt-3 text-sm text-muted">{record.hash_algorithm}</p>
        <p className="mt-1 break-all font-mono text-sm">{record.file_hash}</p>
      </section>

      <DocumentRevisions documentId={record.id} locked={locked} />

      <section id="document-preview" className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Document preview</h3>
        {pageText ? (
          <div className="mt-4 rounded-md border border-line bg-paper p-4">
            <p className="text-sm font-medium">Page {pageText.page_number}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{pageText.text}</p>
          </div>
        ) : null}
        {previewUrl && record.mime_type === "application/pdf" ? (
          <iframe title="Document preview" src={search.get("page") ? `${previewUrl}#page=${search.get("page")}` : previewUrl} className="mt-4 h-[32rem] w-full rounded-md border border-line" />
        ) : null}
        {previewUrl && record.mime_type !== "application/pdf" ? (
          <img alt="" src={previewUrl} className="mt-4 max-h-[32rem] rounded-md border border-line" />
        ) : null}
        {previewNote ? <p className="mt-4 text-sm text-muted">{previewNote}</p> : null}
      </section>

      <AuditTimeline title="Audit history" documentId={record.id} />

      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Access</h3>
        <p className="mt-3 text-sm">Your access: AUTHORIZED</p>
        {!canDownload && canRequest ? (
          <button type="button" className="mt-4 rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => setRequestOpen(true)}>
            Request access
          </button>
        ) : null}
      </section>

      {editing ? (
        <form onSubmit={saveMetadata} className="space-y-3 rounded-lg border border-line bg-white p-6">
          <h3 className="text-base font-semibold">Edit metadata</h3>
          <label className="block text-sm">
            Title
            <input name="title" required minLength={3} maxLength={200} defaultValue={record.title} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
          </label>
          <label className="block text-sm">
            Classification
            <select name="classification" defaultValue={record.classification} className="mt-1 w-full rounded-md border border-line px-3 py-2">
              {CLASSIFICATIONS.map((option) => (
                <option key={option} value={option}>
                  {documentClassificationLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Description
            <textarea name="description" defaultValue={record.description ?? ""} className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={4} />
          </label>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
            Save metadata
          </button>
        </form>
      ) : null}

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
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1">{value}</dd>
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

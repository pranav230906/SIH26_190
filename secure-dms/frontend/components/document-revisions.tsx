"use client";

import { useEffect, useState } from "react";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch, apiFetchBlob, uploadWithProgress } from "@/lib/api";
import { formatTimestamp, versionStatusLabel } from "@/lib/format";
import type { DocumentVersionDetail, DocumentVersionSummary, VersionDiff, VersionIntegrity } from "@/lib/types";

export function DocumentRevisions({ documentId, locked }: { documentId: string; locked: boolean }) {
  const { permissions } = usePermissions();
  const [items, setItems] = useState<DocumentVersionSummary[]>([]);
  const [official, setOfficial] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<DocumentVersionDetail | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [integrity, setIntegrity] = useState<VersionIntegrity | null>(null);
  const [comment, setComment] = useState("");
  const canRevise = can(permissions, "REVISION.CREATE") && !locked;

  async function reload() {
    const data = await apiFetch<{ items: DocumentVersionSummary[]; official_version_number: number | null }>(
      `/api/documents/${documentId}/versions`,
    );
    setItems(data.items);
    setOfficial(data.official_version_number);
  }

  useEffect(() => {
    reload().catch((caught) => {
      setError(caught instanceof ApiClientError ? caught.message : "Version history could not be loaded.");
    });
  }, [documentId]);

  async function openVersion(versionId: string) {
    try {
      const detail = await apiFetch<DocumentVersionDetail>(`/api/document-versions/${versionId}`);
      const check = await apiFetch<VersionIntegrity>(`/api/document-versions/${versionId}/integrity`);
      setSelected(detail);
      setIntegrity(check);
      setDiff(null);
      if (detail.allowed_actions.includes("DIFF")) {
        setDiff(await apiFetch<VersionDiff>(`/api/document-versions/${versionId}/diff`));
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The version could not be opened.");
    }
  }

  async function download(versionId: string, filename: string) {
    try {
      const result = await apiFetchBlob(`/api/document-versions/${versionId}/download`);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The download was refused.");
    }
  }

  async function post(path: string, body?: unknown) {
    try {
      const updated = await apiFetch<DocumentVersionDetail>(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      setSelected(updated);
      setNotice(`${updated.version_label} is now ${versionStatusLabel(updated.status).toLowerCase()}.`);
      setError(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The action was refused.");
    }
  }

  return (
    <section className="rounded-lg border border-line bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Version history</h3>
          <p className="mt-1 text-sm text-muted">Current official: {official ? `v${official}` : "None yet"}</p>
        </div>
        {canRevise && official ? (
          <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => setCreating((current) => !current)}>
            Create new revision
          </button>
        ) : null}
      </div>
      <ol className="mt-4 space-y-2 text-sm text-muted">
        <li>Official version</li>
        <li className="border-l border-line pl-3">New revision, draft</li>
        <li className="border-l border-line pl-3">Submitted for supervisor review</li>
        <li className="border-l border-line pl-3">Reject keeps the revision in history, or approve makes it official and supersedes the previous official version.</li>
      </ol>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm">{notice}</p> : null}
      {creating ? (
        <RevisionForm
          documentId={documentId}
          onClose={() => setCreating(false)}
          onCreated={async (created) => {
            setCreating(false);
            setNotice(`${created.version_label} saved as a draft. It is not official.`);
            await reload();
            await openVersion(created.id);
          }}
          onError={setError}
        />
      ) : null}
      <ul className="mt-4 divide-y divide-line border-t border-line">
        {[...items].reverse().map((item) => (
          <li key={item.id} className="py-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-navy">{item.version_label}{item.is_official ? " · Official" : ""}</p>
              <p>{versionStatusLabel(item.status)}</p>
            </div>
            <p className="mt-1 text-muted">Created by {item.created_by_name} · {formatTimestamp(item.created_at)}</p>
            {item.approved_by_name ? <p className="text-muted">Approved by {item.approved_by_name}{item.approved_at ? ` · ${formatTimestamp(item.approved_at)}` : ""}</p> : null}
            <p className="mt-2">{item.change_summary}</p>
            {item.review_comment ? <p className="mt-2">Reason: {item.review_comment}</p> : null}
            {item.parent_version_number ? <p className="mt-1 text-muted">Parent: v{item.parent_version_number}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-1.5" onClick={() => openVersion(item.id)}>View</button>
              {item.allowed_actions.includes("DOWNLOAD") ? (
                <button type="button" className="rounded-md border border-line px-3 py-1.5" onClick={() => download(item.id, item.original_filename)}>Download</button>
              ) : null}
              {item.allowed_actions.includes("DIFF") ? (
                <button type="button" className="rounded-md border border-line px-3 py-1.5" onClick={() => openVersion(item.id)}>Diff</button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {selected ? (
        <article className="mt-4 rounded-md border border-line p-4">
          <h4 className="text-sm font-semibold">
            {selected.parent_version_number ? `Version ${selected.parent_version_number} → Version ${selected.version_number}` : selected.version_label}
          </h4>
          <p className="mt-2 text-sm">{selected.change_summary}</p>
          <p className="mt-3 text-sm text-muted">Integrity</p>
          <p className="break-all font-mono text-xs">{selected.hash_algorithm} {selected.sha256_hash}</p>
          <p className="mt-1 text-sm">{integrity?.integrity_status ?? "Not checked"}</p>
          {selected.text_excerpt ? <pre className="mt-3 whitespace-pre-wrap rounded-md bg-[#f6f7f8] p-3 text-sm">{selected.text_excerpt}</pre> : null}
          {diff ? <DiffView diff={diff} /> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.allowed_actions.includes("SUBMIT") ? (
              <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => post(`/api/document-versions/${selected.id}/submit-review`)}>Submit for review</button>
            ) : null}
            {selected.allowed_actions.includes("APPROVE") ? (
              <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => post(`/api/document-versions/${selected.id}/review`, { decision: "APPROVE", comment: "Approved as the official version." })}>Approve</button>
            ) : null}
          </div>
          {selected.allowed_actions.includes("REJECT") ? (
            <div className="mt-4">
              <label className="block text-sm">
                Review comment
                <textarea className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
              </label>
              <button type="button" className="mt-2 rounded-md border border-line px-3 py-2 text-sm" onClick={() => post(`/api/document-versions/${selected.id}/review`, { decision: "REJECT", comment })}>Reject</button>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

function DiffView({ diff }: { diff: VersionDiff }) {
  if (!diff.comparable) {
    return <p className="mt-4 text-sm text-muted">{diff.message}</p>;
  }
  const removed = diff.changes.filter((item) => item.type === "removed");
  const added = diff.changes.filter((item) => item.type === "added");
  const unchanged = diff.changes.filter((item) => item.type === "unchanged");
  return (
    <div className="mt-4 space-y-3 text-sm">
      <p className="font-medium">Version {diff.parent_version} → Version {diff.current_version}</p>
      <div>
        <p className="text-muted">Removed</p>
        {removed.length === 0 ? <p>None</p> : removed.map((item, index) => <p key={`r-${index}`} className="whitespace-pre-wrap border-l-2 border-line pl-2">- {item.text}</p>)}
      </div>
      <div>
        <p className="text-muted">Added</p>
        {added.length === 0 ? <p>None</p> : added.map((item, index) => <p key={`a-${index}`} className="whitespace-pre-wrap border-l-2 border-navy pl-2">+ {item.text}</p>)}
      </div>
      <details>
        <summary className="cursor-pointer text-muted">Unchanged sections</summary>
        {unchanged.map((item, index) => <p key={`u-${index}`} className="mt-2 whitespace-pre-wrap text-muted">{item.text}</p>)}
      </details>
    </div>
  );
}

function RevisionForm({
  documentId,
  onClose,
  onCreated,
  onError,
}: {
  documentId: string;
  onClose: () => void;
  onCreated: (version: DocumentVersionDetail) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [summary, setSummary] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      onError("Choose the new version file.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("change_summary", summary);
    setBusy(true);
    try {
      const created = await uploadWithProgress<DocumentVersionDetail>(`/api/documents/${documentId}/revisions`, form, () => undefined);
      await onCreated(created);
    } catch (caught) {
      onError(caught instanceof ApiClientError ? caught.message : "The revision was refused.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-md border border-line p-4">
      <h4 className="text-sm font-semibold">Upload new version</h4>
      <p className="mt-1 text-sm text-muted">This stays a draft until a supervisor approves it.</p>
      <label className="mt-3 block text-sm">
        Change summary
        <textarea className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} required minLength={10} />
      </label>
      <label className="mt-3 block text-sm">
        File
        <input className="mt-1 block w-full text-sm" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>Save draft revision</button>
        <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

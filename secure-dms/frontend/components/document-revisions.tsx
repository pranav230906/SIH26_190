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
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-slate-50 border-b border-slate-200 p-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Revision History
          </h3>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Current Official: {official ? <span className="text-green-700 font-bold bg-green-100 px-2 py-0.5 rounded">v{official}</span> : "None yet"}
          </p>
        </div>
        {canRevise && official ? (
          <button type="button" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm flex items-center gap-2" onClick={() => setCreating((current) => !current)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Revision
          </button>
        ) : null}
      </div>

      <div className="p-6">
        {error ? <p role="alert" className="mb-4 rounded bg-red-50 p-3 text-sm font-medium text-red-700 border border-red-200">{error}</p> : null}
        {notice ? <p className="mb-4 rounded bg-blue-50 p-3 text-sm font-medium text-blue-700 border border-blue-200">{notice}</p> : null}
        
        {creating ? (
          <div className="mb-8">
            <RevisionForm
              documentId={documentId}
              onClose={() => setCreating(false)}
              onCreated={async (created, scanNotice) => {
                setCreating(false);
                setNotice(scanNotice ? `${created.version_label} saved as draft. ${scanNotice}` : `${created.version_label} saved as a draft. It is not official.`);
                await reload();
                await openVersion(created.id);
              }}
              onError={setError}
            />
          </div>
        ) : null}

        <div className="flow-root mt-4">
          <ul role="list" className="-mb-8">
            {[...items].reverse().map((item, index) => {
              const isLast = index === items.length - 1;
              const isOfficial = item.is_official;
              return (
                <li key={item.id}>
                  <div className="relative pb-8">
                    {!isLast ? (
                      <span className="absolute left-5 top-5 -ml-px h-full w-0.5 bg-slate-200" aria-hidden="true" />
                    ) : null}
                    <div className="relative flex items-start space-x-4">
                      <div className="relative">
                        <span className={`h-10 w-10 rounded-full flex items-center justify-center ring-8 ring-white ${isOfficial ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                          {isOfficial ? (
                             <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                          ) : (
                             <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          )}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer overflow-hidden" onClick={() => openVersion(item.id)}>
                        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                           <div className="flex items-center gap-2">
                             <p className={`font-bold text-sm ${isOfficial ? 'text-green-700' : 'text-slate-900'}`}>{item.version_label}</p>
                             {isOfficial ? <span className="bg-green-100 text-green-800 text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-green-200">Official</span> : null}
                             {item.seal_value ? (
                               <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-indigo-200" title="Digitally Sealed">
                                 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                                 Sealed
                               </span>
                             ) : null}
                           </div>
                           <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                             item.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                             item.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                             item.status === 'PENDING_REVIEW' ? 'bg-amber-100 text-amber-800' :
                             'bg-slate-100 text-slate-800'
                           }`}>
                             {versionStatusLabel(item.status)}
                           </span>
                        </div>
                        <div className="p-4">
                           <p className="text-sm text-slate-700 font-medium mb-2">{item.change_summary}</p>
                           <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                             <span className="flex items-center gap-1">
                               <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                               {item.created_by_name}
                             </span>
                             <span className="flex items-center gap-1">
                               <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                               {formatTimestamp(item.created_at)}
                             </span>
                             {item.parent_version_number ? (
                               <span className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[10px]">
                                 Parent: v{item.parent_version_number}
                               </span>
                             ) : null}
                           </div>
                           {item.review_comment || item.approved_by_name ? (
                             <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                               {item.approved_by_name ? <p className="text-xs text-slate-500">Approved by <span className="font-medium text-slate-700">{item.approved_by_name}</span> {item.approved_at ? `on ${formatTimestamp(item.approved_at).split(' ')[0]}` : ""}</p> : null}
                               {item.review_comment ? <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded italic">"{item.review_comment}"</p> : null}
                             </div>
                           ) : null}
                           <div className="mt-4 flex flex-wrap gap-2">
                             <button type="button" className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 shadow-sm" onClick={(e) => { e.stopPropagation(); openVersion(item.id); }}>Inspect Details</button>
                             {item.allowed_actions.includes("DOWNLOAD") ? (
                               <button type="button" className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 shadow-sm flex items-center gap-1" onClick={(e) => { e.stopPropagation(); download(item.id, item.original_filename); }}>
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  Download
                               </button>
                             ) : null}
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      {selected ? (
        <article className="mt-8 rounded-xl border-2 border-indigo-100 bg-indigo-50/30 p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-indigo-100 pb-4 mb-4">
            <h4 className="text-lg font-bold text-slate-900">
              {selected.parent_version_number ? `Comparing Version ${selected.parent_version_number} → Version ${selected.version_number}` : `Inspection: ${selected.version_label}`}
            </h4>
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setSelected(null)}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Change Summary</p>
              <p className="text-sm text-slate-800 bg-white p-3 rounded-lg border border-slate-200">{selected.change_summary}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cryptographic Integrity</p>
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                 <p className="break-all font-mono text-[10px] text-slate-600 mb-2"><span className="font-bold text-slate-400">{selected.hash_algorithm}:</span> {selected.sha256_hash}</p>
                 <div className="flex items-center gap-2">
                   {integrity?.integrity_status === 'VERIFIED' ? <span className="h-2 w-2 rounded-full bg-green-500"></span> : <span className="h-2 w-2 rounded-full bg-slate-300"></span>}
                   <span className="text-xs font-medium text-slate-700">{integrity?.integrity_status ?? "Verification pending..."}</span>
                 </div>
              </div>
            </div>
          </div>
          
          {selected.seal_value ? (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                <p className="text-sm font-bold uppercase tracking-wider text-green-900">
                  Official Digital Seal Verified ({selected.seal_algorithm ?? "HMAC-SHA256"})
                </p>
              </div>
              <p className="mt-2 text-xs text-green-800">
                Cryptographic signature generated upon supervisor approval:
              </p>
              <p className="mt-1 break-all font-mono text-[10px] font-bold text-green-900 bg-white/50 p-2 rounded">
                {selected.seal_value}
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 font-medium flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Digital seal: Pending supervisor approval
            </div>
          )}
          
          {selected.text_excerpt ? (
            <div className="mt-6">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Text Excerpt</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-sm text-slate-300 font-mono overflow-x-auto">{selected.text_excerpt}</pre>
            </div>
          ) : null}
          
          {diff ? <DiffView diff={diff} /> : null}
          
          <div className="mt-6 flex flex-wrap gap-3 pt-4 border-t border-indigo-200">
            {selected.allowed_actions.includes("SUBMIT") ? (
              <button type="button" className="rounded-md bg-blue-600 hover:bg-blue-700 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors" onClick={() => post(`/api/document-versions/${selected.id}/submit-review`)}>Submit for Supervisor Review</button>
            ) : null}
            {selected.allowed_actions.includes("APPROVE") ? (
              <button type="button" className="rounded-md bg-green-600 hover:bg-green-700 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors" onClick={() => post(`/api/document-versions/${selected.id}/review`, { decision: "APPROVE", comment: "Approved as the official version." })}>Promote to Official</button>
            ) : null}
          </div>
          {selected.allowed_actions.includes("REJECT") ? (
            <div className="mt-4 bg-red-50 p-4 rounded-lg border border-red-200">
              <label className="block text-sm font-bold text-red-900 mb-2">
                Reject Revision
              </label>
              <textarea className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm focus:ring-red-500 focus:border-red-500" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Provide reasoning for rejection..." />
              <button type="button" className="mt-3 rounded-md bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors" onClick={() => post(`/api/document-versions/${selected.id}/review`, { decision: "REJECT", comment })}>Reject</button>
            </div>
          ) : null}
        </article>
      ) : null}
      </div>
    </section>
  );
}

function DiffView({ diff }: { diff: VersionDiff }) {
  if (!diff.comparable) {
    return <p className="mt-6 text-sm text-slate-500 italic p-4 bg-slate-50 rounded-lg border border-slate-200">{diff.message}</p>;
  }
  const removed = diff.changes.filter((item) => item.type === "removed");
  const added = diff.changes.filter((item) => item.type === "added");
  const unchanged = diff.changes.filter((item) => item.type === "unchanged");
  return (
    <div className="mt-6">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Text Diff (v{diff.parent_version} → v{diff.current_version})</p>
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden text-sm font-mono leading-relaxed">
        {removed.length > 0 && (
          <div className="bg-red-50/50 p-4 border-b border-slate-100">
            {removed.map((item, index) => <p key={`r-${index}`} className="whitespace-pre-wrap text-red-800 break-words">- {item.text}</p>)}
          </div>
        )}
        {added.length > 0 && (
          <div className="bg-green-50/50 p-4 border-b border-slate-100">
            {added.map((item, index) => <p key={`a-${index}`} className="whitespace-pre-wrap text-green-800 break-words">+ {item.text}</p>)}
          </div>
        )}
        <details className="p-2 bg-slate-50 group cursor-pointer">
          <summary className="text-xs font-semibold text-slate-500 select-none px-2 group-hover:text-slate-700">Show Unchanged Context</summary>
          <div className="mt-2 p-2">
            {unchanged.map((item, index) => <p key={`u-${index}`} className="whitespace-pre-wrap text-slate-400 opacity-75">{item.text}</p>)}
          </div>
        </details>
      </div>
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
  onCreated: (version: DocumentVersionDetail, notice: string | null) => Promise<void>;
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
      await onCreated(created, created.security_scan_message ?? null);
    } catch (caught) {
      onError(caught instanceof ApiClientError ? caught.message : "The revision was refused.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border-2 border-blue-200 bg-blue-50/30 p-6 shadow-sm">
      <h4 className="text-lg font-bold text-slate-900 mb-1">Upload New Revision</h4>
      <p className="text-sm text-slate-600 mb-4">This revision will be securely stored as a draft until a supervisor promotes it to official status.</p>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Change Summary</label>
          <textarea className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Describe the edits made in this version..." required minLength={10} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Document File</label>
          <div className="flex items-center justify-center w-full">
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-white hover:bg-slate-50 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg className="w-8 h-8 mb-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">Click to upload</span> or drag and drop</p>
              </div>
              <input type="file" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
            </label>
          </div>
          {file && <p className="mt-2 text-sm text-green-600 font-medium flex items-center gap-1"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Selected: {file.name}</p>}
        </div>
      </div>
      
      <div className="mt-6 flex gap-3 pt-4 border-t border-blue-100">
        <button type="submit" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-5 py-2 text-sm font-bold text-white shadow-sm flex items-center gap-2" disabled={busy}>
           {busy ? (
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
           ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
           )}
           Commit Draft Revision
        </button>
        <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

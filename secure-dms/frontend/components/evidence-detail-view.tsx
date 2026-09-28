"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DocumentClassificationBadge } from "@/components/document-badges";
import { downloadFile } from "@/components/evidence-view";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch, uploadWithProgress } from "@/lib/api";
import {
  artifactTypeLabel,
  custodyEventLabel,
  evidenceStatusLabel,
  evidenceTypeLabel,
  formatFileSize,
  formatTimestamp,
} from "@/lib/format";
import type { ArtifactSummary, CustodyEvent, DirectoryUser, EvidenceDetail, IntegrityResult, ProvenanceNode, ProvenanceResponse } from "@/lib/types";

const ARTIFACT_TYPES = [
  "VIDEO_CLIP",
  "IMAGE_CROP",
  "ENHANCED_IMAGE",
  "AUDIO_EXTRACTION",
  "CONVERTED_FILE",
  "SCREENSHOT",
  "TEXT_EXTRACTION",
  "ANNOTATION",
  "FORENSIC_OUTPUT",
  "OTHER",
];

export function EvidenceDetailView() {
  const params = useParams<{ evidenceId: string }>();
  const { permissions } = usePermissions();
  const [record, setRecord] = useState<EvidenceDetail | null>(null);
  const [chain, setChain] = useState<ProvenanceResponse | null>(null);
  const [custody, setCustody] = useState<CustodyEvent[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [sourceArtifactId, setSourceArtifactId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferToUserId, setTransferToUserId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [transferBusy, setTransferBusy] = useState(false);
  const canDownload = can(permissions, "EVIDENCE.DOWNLOAD");
  const canDownloadArtifact = can(permissions, "DERIVED_ARTIFACT.DOWNLOAD");

  useEffect(() => {
    if (transferOpen && directoryUsers.length === 0) {
      apiFetch<{ items: DirectoryUser[] }>("/api/users/directory")
        .then((res) => setDirectoryUsers(res.items))
        .catch(() => {});
    }
  }, [transferOpen, directoryUsers.length]);

  async function reload() {
    const data = await apiFetch<EvidenceDetail>(`/api/evidence/${params.evidenceId}`);
    const tree = await apiFetch<ProvenanceResponse>(`/api/evidence/${params.evidenceId}/provenance`);
    const timeline = await apiFetch<{ items: CustodyEvent[] }>(`/api/evidence/${params.evidenceId}/chain-of-custody`);
    setRecord(data);
    setChain(tree);
    setCustody(timeline.items);
  }

  useEffect(() => {
    let cancelled = false;
    reload().catch((caught) => {
      if (cancelled) return;
      if (caught instanceof ApiClientError && caught.status === 404) {
        setMissing(true);
        return;
      }
      setError(caught instanceof ApiClientError ? caught.message : "The evidence could not be loaded.");
    });
    return () => {
      cancelled = true;
    };
  }, [params.evidenceId]);

  async function runIntegrity() {
    try {
      const result = await apiFetch<IntegrityResult>(`/api/evidence/${params.evidenceId}/integrity`);
      setIntegrity(result);
      if (record) setRecord({ ...record, last_integrity_status: result.integrity_status });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The integrity check could not be completed.");
    }
  }

  async function postAction(action: "verify" | "seal" | "archive") {
    try {
      const updated = await apiFetch<EvidenceDetail>(`/api/evidence/${params.evidenceId}/${action}`, { method: "POST" });
      setRecord(updated);
      setNotice(action === "verify" ? "Evidence marked verified." : action === "seal" ? "Evidence sealed." : "Evidence archived.");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The action was refused.");
    }
  }

  if (missing) return <p className="text-sm text-muted">Evidence not found.</p>;
  if (!record) return <p className="text-sm text-muted">{error ?? "Loading evidence"}</p>;

  const shownIntegrity = integrity?.integrity_status ?? record.last_integrity_status;

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mb-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold tracking-widest text-indigo-600 uppercase">Original Evidence · Immutable</p>
          <span className="text-sm font-medium text-slate-500 font-mono">{record.evidence_number}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="mt-1 text-3xl font-bold text-slate-900 tracking-tight">{record.title}</h2>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 border border-slate-200">{evidenceTypeLabel(record.evidence_type)}</span>
              <DocumentClassificationBadge value={record.classification} />
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium border ${record.status === 'SEALED' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-green-50 text-green-800 border-green-200'}`}>{evidenceStatusLabel(record.status)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canDownload ? (
              <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm flex items-center gap-2" onClick={() => downloadFile(`/api/evidence/${record.id}/download`, setError)}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download Master
              </button>
            ) : null}
            {record.allowed_actions.includes("CREATE_ARTIFACT") ? (
              <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={() => { setSourceArtifactId(null); setArtifactOpen(true); }}>
                Derive Artifact
              </button>
            ) : null}
            {record.allowed_actions.includes("VERIFY_STATUS") ? (
              <button type="button" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => postAction("verify")}>Mark Verified</button>
            ) : null}
            {record.allowed_actions.includes("SEAL") ? (
              <button type="button" className="rounded-md bg-amber-600 hover:bg-amber-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => postAction("seal")}>Seal Evidence</button>
            ) : null}
            {record.allowed_actions.includes("ARCHIVE") ? (
              <button type="button" className="rounded-md bg-slate-800 hover:bg-slate-900 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => postAction("archive")}>Archive</button>
            ) : null}
          </div>
        </div>
      </header>
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Main Info & Provenance */}
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Evidence Details</h3>
            <dl className="grid gap-y-4 gap-x-6 sm:grid-cols-2">
              <Info label="Description" value={record.description || "No description."} />
              <div className="sm:col-span-2 pt-2 border-t border-slate-100"></div>
              <Info label="File Type" value={record.mime_type} />
              <Info label="File Size" value={formatFileSize(record.file_size)} />
              <Info label="Case Link" value={<Link className="text-blue-600 hover:underline font-medium" href={`/cases/${record.case_id}`}>{record.case_number}</Link>} />
              <Info label="Created Date" value={formatTimestamp(record.created_at)} />
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Digital Provenance</h3>
            <article className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-5 shadow-inner">
              <p className="text-xs font-bold tracking-wider text-indigo-700 uppercase mb-2">Original Root Evidence</p>
              <p className="font-semibold text-slate-900">{chain?.title ?? record.title}</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-600 bg-white p-2 rounded border border-indigo-100/50">
                <span className="text-indigo-400 select-none mr-2">{record.hash_algorithm}:</span>{record.sha256_hash}
              </p>
            </article>
            {chain && chain.artifacts.length > 0 ? (
              <div className="mt-4 space-y-3 border-l-2 border-indigo-100 pl-5 ml-2">
                {chain.artifacts.map((node) => (
                  <ProvenanceBranch
                    key={node.id}
                    node={node}
                    evidenceNumber={record.evidence_number}
                    canDownload={canDownloadArtifact}
                    canDerive={record.allowed_actions.includes("CREATE_ARTIFACT")}
                    onDerive={(id) => {
                      setSourceArtifactId(id);
                      setArtifactOpen(true);
                    }}
                    onError={setError}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-500 italic">No derived artifacts have been created from this root evidence yet.</p>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: Chain of Custody & Integrity */}
        <div className="lg:col-span-1 space-y-6">
          <section className="rounded-xl border-2 border-slate-800 bg-slate-900 p-6 shadow-md text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-24 h-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            </div>
            <div className="relative z-10">
              <h3 className="text-sm font-semibold tracking-wider text-slate-400 uppercase mb-4">Current Custody</h3>
              <p className="text-xl font-bold text-white">{record.custodian_name || "Case Vault"}</p>
              <p className="text-sm text-slate-400 mt-1">Logged by: {record.created_by_name}</p>
              
              {record.allowed_actions.includes("TRANSFER") ? (
                <button
                  type="button"
                  className="mt-6 w-full rounded-md bg-white hover:bg-slate-100 transition-colors px-4 py-2.5 text-sm font-bold text-slate-900 shadow-sm flex items-center justify-center gap-2"
                  onClick={() => {
                    setTransferReason("");
                    setTransferToUserId("");
                    setTransferOpen(true);
                  }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                  Transfer Custody
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-4">Cryptographic Hash</h3>
            <p className="text-xs font-medium text-slate-500 mb-1">{record.hash_algorithm}</p>
            <div className="bg-slate-50 border border-slate-200 rounded p-2.5 overflow-hidden mb-4">
               <p className="break-all font-mono text-xs text-slate-700">{record.sha256_hash}</p>
            </div>
            
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Integrity Check</p>
                <div className="flex items-center gap-2">
                  {shownIntegrity === 'VERIFIED' ? (
                    <span className="flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
                  ) : shownIntegrity === 'FAILED' ? (
                    <span className="flex h-2.5 w-2.5 rounded-full bg-red-500"></span>
                  ) : (
                    <span className="flex h-2.5 w-2.5 rounded-full bg-slate-300"></span>
                  )}
                  <p className="text-sm font-medium text-slate-900">{shownIntegrity ?? "Pending"}</p>
                </div>
              </div>
              <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm" onClick={runIntegrity}>Verify Now</button>
            </div>
            {integrity ? <p className="mt-3 break-all font-mono text-[10px] text-slate-400 bg-slate-50 p-2 rounded">Checked hash: {integrity.current_hash}</p> : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-5">Custody Timeline</h3>
            {custody.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No custody events have been recorded.</p>
            ) : (
              <div className="flow-root">
                <ul role="list" className="-mb-8">
                  {custody.map((event, index) => (
                    <li key={event.id}>
                      <div className="relative pb-8">
                        {index !== custody.length - 1 ? (
                          <span className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-slate-200" aria-hidden="true" />
                        ) : null}
                        <div className="relative flex space-x-3">
                          <div>
                            <span className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center ring-8 ring-white text-slate-500">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                            <div>
                              <p className="text-sm text-slate-900 font-medium">{custodyEventLabel(event.event_type)}</p>
                              <p className="text-xs text-slate-500 mt-1">{event.performed_by_name}</p>
                              <p className="mt-2 text-sm text-slate-700 bg-slate-50 rounded p-2 border border-slate-100">{event.description}</p>
                            </div>
                            <div className="whitespace-nowrap text-right text-xs text-slate-500">
                              <time>{formatTimestamp(event.performed_at).split(' ')[0]}</time>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
      

      {artifactOpen ? (
        <ArtifactDialog
          evidenceId={record.id}
          sourceArtifactId={sourceArtifactId}
          onClose={() => setArtifactOpen(false)}
          onCreated={async (scanNotice) => {
            setArtifactOpen(false);
            setNotice(scanNotice ? `Derived artifact stored. ${scanNotice}` : "Derived artifact stored. The original evidence was not changed.");
            await reload();
          }}
          onError={setError}
        />
      ) : null}
      {transferOpen ? (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-navy/40 p-4">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setTransferBusy(true);
              try {
                const updated = await apiFetch<EvidenceDetail>(`/api/evidence/${record.id}/transfer`, {
                  method: "POST",
                  body: JSON.stringify({
                    to_user_id: transferToUserId,
                    reason: transferReason.trim(),
                  }),
                });
                setRecord(updated);
                setTransferOpen(false);
                setNotice("Evidence custody transferred successfully.");
                await reload();
              } catch (caught) {
                setError(caught instanceof ApiClientError ? caught.message : "Failed to transfer evidence custody.");
              } finally {
                setTransferBusy(false);
              }
            }}
            className="my-8 w-[min(100%,32rem)] space-y-4 rounded-lg border border-line bg-white p-6"
          >
            <h3 className="text-lg font-semibold text-navy">Transfer Evidence Custody</h3>
            <p className="text-sm text-muted">
              Transfer custodianship of this evidence item to another active case participant. Every transfer is permanently logged in the chain of custody.
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
              <span className="font-medium text-navy">Transfer Justification / Reason</span>
              <textarea
                required
                minLength={3}
                rows={3}
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                placeholder="Reason for custody transfer (e.g. handoff to forensic lab for analysis)..."
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={transferBusy}
                className="rounded-md border border-line px-4 py-2 text-sm"
                onClick={() => setTransferOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={transferBusy || !transferToUserId}
                className="rounded-md bg-navy px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {transferBusy ? "Transferring…" : "Confirm Transfer"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProvenanceBranch({
  node,
  evidenceNumber,
  canDownload,
  canDerive,
  onDerive,
  onError,
}: {
  node: ProvenanceNode;
  evidenceNumber: string;
  canDownload: boolean;
  canDerive: boolean;
  onDerive: (id: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="pt-3">
      <p className="text-xs text-muted">↓</p>
      <article className="rounded-md border border-line bg-white p-4">
        <p className="text-xs font-medium text-brass">DERIVED ARTIFACT</p>
        <p className="text-xs text-muted">Source: Evidence {evidenceNumber}</p>
        <p className="mt-1 font-medium">{node.artifact_number}</p>
        <p>{node.title}</p>
        <p className="mt-1 text-sm text-muted">{artifactTypeLabel(node.artifact_type)} · {node.created_by_name}</p>
        <p className="mt-2 break-all font-mono text-xs">{node.hash_algorithm}: {node.sha256_hash}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/artifacts/${node.id}`} className="rounded-md border border-line px-2 py-1 text-xs">View</Link>
          {canDownload ? (
            <button type="button" className="rounded-md border border-line px-2 py-1 text-xs" onClick={() => downloadFile(`/api/artifacts/${node.id}/download`, onError)}>
              Download
            </button>
          ) : null}
          {canDerive ? (
            <button type="button" className="rounded-md border border-line px-2 py-1 text-xs" onClick={() => onDerive(node.id)}>
              Derive next
            </button>
          ) : null}
        </div>
      </article>
      {node.children.length > 0 ? (
        <div className="ml-4 border-l border-line pl-4">
          {node.children.map((child) => (
            <ProvenanceBranch
              key={child.id}
              node={child}
              evidenceNumber={evidenceNumber}
              canDownload={canDownload}
              canDerive={canDerive}
              onDerive={onDerive}
              onError={onError}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArtifactDialog({
  evidenceId,
  sourceArtifactId,
  onClose,
  onCreated,
  onError,
}: {
  evidenceId: string;
  sourceArtifactId: string | null;
  onClose: () => void;
  onCreated: (notice: string | null) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artifactType, setArtifactType] = useState("OTHER");
  const [processing, setProcessing] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("title", title);
    form.set("artifact_type", artifactType);
    form.set("processing_description", processing);
    if (description.trim()) form.set("description", description.trim());
    const path = sourceArtifactId ? `/api/artifacts/${sourceArtifactId}/artifacts` : `/api/evidence/${evidenceId}/artifacts`;
    try {
      const created = await uploadWithProgress<ArtifactSummary>(path, form, setProgress);
      await onCreated(created.security_scan_message ?? null);
    } catch (caught) {
      onError(caught instanceof ApiClientError ? caught.message : "The artifact could not be stored.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-navy/40 p-4">
      <form onSubmit={submit} className="my-8 w-[min(100%,36rem)] space-y-4 rounded-lg border border-line bg-white p-6">
        <h3 className="text-lg font-semibold text-navy">Create derived artifact</h3>
        <p className="text-sm text-muted">This stores a new file. The original evidence is left unchanged.</p>
        <label className="block text-sm">File<input required type="file" className="mt-1 block w-full text-sm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label className="block text-sm">Title<input required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" /></label>
        <label className="block text-sm">
          Artifact type
          <select value={artifactType} onChange={(event) => setArtifactType(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
            {ARTIFACT_TYPES.map((option) => <option key={option} value={option}>{artifactTypeLabel(option)}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Processing description
          <textarea required minLength={10} value={processing} onChange={(event) => setProcessing(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} />
        </label>
        <label className="block text-sm">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={2} /></label>
        {progress !== null ? <p className="text-sm text-muted">Upload progress {progress}%</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>Store artifact</button>
        </div>
      </form>
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

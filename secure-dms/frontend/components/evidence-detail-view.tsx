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
      <header className="rounded-lg border border-line bg-white p-6">
        <p className="text-xs font-medium tracking-wide text-navy">ORIGINAL EVIDENCE · IMMUTABLE</p>
        <p className="mt-2 text-sm text-muted">{record.evidence_number}</p>
        <h2 className="mt-1 text-2xl font-semibold text-navy">{record.title}</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span>{evidenceTypeLabel(record.evidence_type)}</span>
          <DocumentClassificationBadge value={record.classification} />
          <span>{evidenceStatusLabel(record.status)}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {canDownload ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => downloadFile(`/api/evidence/${record.id}/download`, setError)}>
              Download original
            </button>
          ) : null}
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={runIntegrity}>Verify integrity</button>
          {record.allowed_actions.includes("CREATE_ARTIFACT") ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => { setSourceArtifactId(null); setArtifactOpen(true); }}>
              Create derived artifact
            </button>
          ) : null}
          {record.allowed_actions.includes("VERIFY_STATUS") ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => postAction("verify")}>Mark verified</button>
          ) : null}
          {record.allowed_actions.includes("SEAL") ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => postAction("seal")}>Seal evidence</button>
          ) : null}
          {record.allowed_actions.includes("ARCHIVE") ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => postAction("archive")}>Archive</button>
          ) : null}
          {record.allowed_actions.includes("TRANSFER") ? (
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
        <h3 className="text-base font-semibold">Evidence information</h3>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Case" value={<Link className="text-navy underline" href={`/cases/${record.case_id}`}>{record.case_number}</Link>} />
          <Info label="Created by" value={record.created_by_name} />
          <Info label="Current custodian" value={record.custodian_name || record.created_by_name} />
          <Info label="Created date" value={formatTimestamp(record.created_at)} />
          <Info label="File type" value={record.mime_type} />
          <Info label="File size" value={formatFileSize(record.file_size)} />
          <Info label="Description" value={record.description || "No description."} />
        </dl>
      </section>
      <section id="integrity" className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Integrity</h3>
        <p className="mt-3 text-sm text-muted">Hash algorithm</p>
        <p className="text-sm">{record.hash_algorithm}</p>
        <p className="mt-3 text-sm text-muted">Original hash</p>
        <p className="break-all font-mono text-sm">{record.sha256_hash}</p>
        <p className="mt-3 text-sm">Integrity: {shownIntegrity ?? "Not checked yet"}</p>
        {integrity ? <p className="mt-2 break-all font-mono text-xs text-muted">Current hash {integrity.current_hash}</p> : null}
        <button type="button" className="mt-4 rounded-md border border-line px-3 py-2 text-sm" onClick={runIntegrity}>Verify integrity</button>
      </section>
      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Chain of custody</h3>
        {custody.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No custody events have been recorded.</p>
        ) : (
          <ol className="mt-4">
            {custody.map((event, index) => (
              <li key={event.id} className="relative pb-6 pl-6 last:pb-0">
                {index < custody.length - 1 ? <span className="absolute left-[7px] top-3 h-full w-px bg-line" /> : null}
                <span className="absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 border-navy bg-white" />
                <p className="text-sm font-medium">{custodyEventLabel(event.event_type)}</p>
                <p className="text-sm text-muted">{event.performed_by_name}</p>
                <p className="text-sm text-muted">{formatTimestamp(event.performed_at)}</p>
                <p className="mt-1 text-sm">{event.description}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Provenance</h3>
        <article className="mt-4 rounded-md border border-navy/20 bg-[#eef3f8] p-4">
          <p className="text-xs font-medium text-navy">ORIGINAL EVIDENCE</p>
          <p className="mt-1 font-medium">{chain?.title ?? record.title}</p>
          <p className="mt-1 break-all font-mono text-xs">{record.hash_algorithm}: {record.sha256_hash}</p>
        </article>
        {chain && chain.artifacts.length > 0 ? (
          <div className="mt-2 space-y-2 border-l border-line pl-4">
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
          <p className="mt-4 text-sm text-muted">No derived artifacts have been created.</p>
        )}
      </section>
      {artifactOpen ? (
        <ArtifactDialog
          evidenceId={record.id}
          sourceArtifactId={sourceArtifactId}
          onClose={() => setArtifactOpen(false)}
          onCreated={async () => {
            setArtifactOpen(false);
            setNotice("Derived artifact stored. The original evidence was not changed.");
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
  onCreated: () => Promise<void>;
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
      await uploadWithProgress<ArtifactSummary>(path, form, setProgress);
      await onCreated();
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
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}

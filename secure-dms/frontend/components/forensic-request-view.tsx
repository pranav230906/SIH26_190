"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiClientError, apiFetch, uploadWithProgress } from "@/lib/api";
import { artifactTypeLabel, evidenceTypeLabel, forensicStatusLabel, forensicTypeLabel, formatTimestamp } from "@/lib/format";
import type { DirectoryUser, ForensicRequestDetail } from "@/lib/types";

const ARTIFACT_TYPES = ["FORENSIC_OUTPUT", "VIDEO_CLIP", "IMAGE_CROP", "AUDIO_EXTRACTION", "ANNOTATION", "TEXT_EXTRACTION", "OTHER"];
const FINDING_TYPES = ["OBSERVATION", "IDENTIFICATION", "CORRELATION", "ANOMALY", "TECHNICAL_FINDING", "OTHER"];

export function ForensicRequestView() {
  const params = useParams<{ requestId: string }>();
  const [record, setRecord] = useState<ForensicRequestDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [examiners, setExaminers] = useState<DirectoryUser[]>([]);
  const [examinerId, setExaminerId] = useState("");
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [findingOpen, setFindingOpen] = useState(false);

  async function reload() {
    const data = await apiFetch<ForensicRequestDetail>(`/api/forensic-requests/${params.requestId}`);
    setRecord(data);
  }

  useEffect(() => {
    reload().catch((caught) => {
      if (caught instanceof ApiClientError && caught.status === 404) {
        setMissing(true);
        return;
      }
      setError(caught instanceof ApiClientError ? caught.message : "The request could not be loaded.");
    });
  }, [params.requestId]);

  useEffect(() => {
    if (!record?.allowed_actions.includes("ASSIGN")) return;
    apiFetch<{ items: DirectoryUser[] }>("/api/users/directory")
      .then((data) => setExaminers(data.items.filter((item) => item.role_name === "FORENSIC_EXAMINER" && item.is_active)))
      .catch(() => setExaminers([]));
  }, [record?.allowed_actions]);

  async function post(path: string, body?: unknown) {
    try {
      const updated = await apiFetch<ForensicRequestDetail>(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      setRecord(updated);
      setError(null);
      return updated;
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The action was refused.");
      return null;
    }
  }

  if (missing) return <p className="text-sm text-muted">Forensic request not found.</p>;
  if (!record) return <p className="text-sm text-muted">{error ?? "Loading forensic request"}</p>;

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-line bg-white p-6">
        <p className="text-sm text-muted">{record.request_number}</p>
        <h2 className="mt-1 text-2xl font-semibold text-navy">{forensicTypeLabel(record.request_type)}</h2>
        <p className="mt-2 text-sm">
          <Link href={`/cases/${record.case_id}`} className="text-navy underline">{record.case_number}</Link>
          <span className="text-muted"> · {record.case_title}</span>
        </p>
        <p className="mt-2 text-sm">{forensicStatusLabel(record.status)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {record.allowed_actions.includes("APPROVE") ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => post(`/api/forensic-requests/${record.id}/approve`).then((updated) => updated && setNotice("Request approved."))}>Approve</button>
          ) : null}
          {record.allowed_actions.includes("START") ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => post(`/api/forensic-requests/${record.id}/start`).then((updated) => updated && setNotice("Examination started. The original evidence remains read-only."))}>Start examination</button>
          ) : null}
          {record.allowed_actions.includes("CREATE_ARTIFACT") ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => setArtifactOpen(true)}>Create derived artifact</button>
          ) : null}
          {record.allowed_actions.includes("ADD_FINDING") ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => setFindingOpen(true)}>Add finding</button>
          ) : null}
          {record.allowed_actions.includes("SUBMIT_REVIEW") ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => post(`/api/forensic-requests/${record.id}/submit-review`).then((updated) => updated && setNotice("Submitted for review."))}>Submit for review</button>
          ) : null}
          {record.allowed_actions.includes("REVIEW") ? (
            <button type="button" className="rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => post(`/api/forensic-requests/${record.id}/review`, { decision: "ACCEPT", comment: "Findings and provenance accepted." }).then((updated) => updated && setNotice("Review accepted. The request is completed."))}>Accept</button>
          ) : null}
        </div>
      </header>
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}
      <section className="rounded-lg border border-line bg-white p-6 text-sm">
        <h3 className="text-base font-semibold">Request</h3>
        <p className="mt-3 text-muted">Requested by</p>
        <p>{record.requested_by_name} · {formatTimestamp(record.requested_at)}</p>
        <p className="mt-3 text-muted">Assigned examiner</p>
        <p>{record.assigned_to_name ?? "Unassigned"}</p>
        <p className="mt-3 text-muted">Reason</p>
        <p>{record.reason}</p>
        <p className="mt-3 text-muted">Instructions</p>
        <p>{record.instructions}</p>
        {record.approved_by_name ? <p className="mt-3">Approved by {record.approved_by_name} · {record.approved_at ? formatTimestamp(record.approved_at) : ""}</p> : null}
        {record.rejection_reason ? <p className="mt-3">Rejected: {record.rejection_reason}</p> : null}
        {record.review_comment ? <p className="mt-3">Review comment: {record.review_comment}</p> : null}
      </section>
      {record.allowed_actions.includes("REJECT") ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <h3 className="text-base font-semibold">Reject request</h3>
          <textarea className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm" rows={3} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Reason for rejection" />
          <button type="button" className="mt-3 rounded-md border border-line px-3 py-2 text-sm" onClick={() => post(`/api/forensic-requests/${record.id}/reject`, { reason: rejectReason }).then((updated) => updated && setNotice("Request rejected."))}>Reject</button>
        </section>
      ) : null}
      {record.allowed_actions.includes("ASSIGN") ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <h3 className="text-base font-semibold">Assign examiner</h3>
          <select className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm" value={examinerId} onChange={(event) => setExaminerId(event.target.value)}>
            <option value="">Choose an examiner</option>
            {examiners.map((person) => (
              <option key={person.id} value={person.id}>{person.full_name}</option>
            ))}
          </select>
          <button type="button" className="mt-3 rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => post(`/api/forensic-requests/${record.id}/assign`, { examiner_id: examinerId }).then((updated) => updated && setNotice("Examiner assigned."))}>Assign</button>
        </section>
      ) : null}
      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Requested evidence</h3>
        <ul className="mt-3 space-y-3 text-sm">
          {record.evidence.map((item) => (
            <li key={item.id} className="rounded-md border border-line p-3">
              <p className="font-medium">{item.evidence_number}</p>
              <p>{item.title}</p>
              <p className="text-muted">{evidenceTypeLabel(item.evidence_type)} · {item.status}</p>
              <p className="mt-1">{item.purpose}</p>
              <p className="mt-1 break-all font-mono text-xs">SHA-256 {item.sha256_hash}</p>
              <p className="mt-1">Integrity: {item.integrity_status ?? "Not checked in this view"}</p>
              <Link href={`/evidence/${item.id}`} className="mt-2 inline-flex text-navy underline">Open evidence</Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Derived artifacts</h3>
        {record.artifacts.length === 0 ? <p className="mt-3 text-sm text-muted">No artifact has been produced for this request.</p> : (
          <ul className="mt-3 space-y-3 text-sm">
            {record.artifacts.map((item) => (
              <li key={item.id} className="rounded-md border border-line p-3">
                <p className="font-medium">{item.artifact_number} · {item.title}</p>
                <p className="text-muted">{artifactTypeLabel(item.artifact_type)} · {item.created_by_name} · {formatTimestamp(item.created_at)}</p>
                <p className="mt-1">{item.processing_description}</p>
                <p className="mt-1 break-all font-mono text-xs">SHA-256 {item.sha256_hash}</p>
                <p className="mt-1">Source evidence remains linked. Request {record.request_number}.</p>
                <Link href={`/artifacts/${item.id}`} className="mt-2 inline-flex text-navy underline">Open artifact</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-lg border border-line bg-white p-6">
        <h3 className="text-base font-semibold">Findings</h3>
        {record.findings.length === 0 ? <p className="mt-3 text-sm text-muted">No findings have been recorded.</p> : (
          <ul className="mt-3 space-y-3 text-sm">
            {record.findings.map((item) => (
              <li key={item.id} className="rounded-md border border-line p-3">
                <p className="font-medium">{item.finding_number} · {item.title}</p>
                <p className="text-muted">{item.finding_type} · {item.status} · {item.created_by_name}</p>
                <p className="mt-1">{item.description}</p>
                {item.artifact_numbers.length > 0 ? <p className="mt-1">Supports: {item.artifact_numbers.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {record.allowed_actions.includes("REVIEW") ? (
        <section className="rounded-lg border border-line bg-white p-6">
          <h3 className="text-base font-semibold">Return for correction</h3>
          <textarea className="mt-3 w-full rounded-md border border-line px-3 py-2 text-sm" rows={3} value={returnComment} onChange={(event) => setReturnComment(event.target.value)} placeholder="Comment is required" />
          <button type="button" className="mt-3 rounded-md border border-line px-3 py-2 text-sm" onClick={() => post(`/api/forensic-requests/${record.id}/review`, { decision: "RETURN", comment: returnComment }).then((updated) => updated && setNotice("Returned to the examiner."))}>Return</button>
        </section>
      ) : null}
      {artifactOpen ? (
        <ArtifactForm
          request={record}
          onClose={() => setArtifactOpen(false)}
          onCreated={async () => {
            setArtifactOpen(false);
            setNotice("Derived artifact stored. The original evidence was not changed.");
            await reload();
          }}
          onError={setError}
        />
      ) : null}
      {findingOpen ? (
        <FindingForm
          request={record}
          onClose={() => setFindingOpen(false)}
          onCreated={async (updated) => {
            setFindingOpen(false);
            setRecord(updated);
            setNotice("Finding recorded.");
          }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function ArtifactForm({
  request,
  onClose,
  onCreated,
  onError,
}: {
  request: ForensicRequestDetail;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [evidenceId, setEvidenceId] = useState(request.evidence[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [artifactType, setArtifactType] = useState("FORENSIC_OUTPUT");
  const [processing, setProcessing] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      onError("Choose the derived file.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("evidence_id", evidenceId);
    form.set("title", title);
    form.set("artifact_type", artifactType);
    form.set("processing_description", processing);
    setBusy(true);
    try {
      await uploadWithProgress(`/api/forensic-requests/${request.id}/artifacts`, form, () => undefined);
      await onCreated();
    } catch (caught) {
      onError(caught instanceof ApiClientError ? caught.message : "The artifact was refused.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-white p-6">
      <h3 className="text-base font-semibold">Create derived artifact</h3>
      <p className="mt-1 text-sm text-muted">The original evidence file is not replaced.</p>
      <label className="mt-4 block text-sm">
        Source evidence
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2" value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)}>
          {request.evidence.map((item) => (
            <option key={item.id} value={item.id}>{item.evidence_number} · {item.title}</option>
          ))}
        </select>
      </label>
      <label className="mt-4 block text-sm">
        Title
        <input className="mt-1 w-full rounded-md border border-line px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} />
      </label>
      <label className="mt-4 block text-sm">
        Artifact type
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2" value={artifactType} onChange={(event) => setArtifactType(event.target.value)}>
          {ARTIFACT_TYPES.map((value) => <option key={value} value={value}>{artifactTypeLabel(value)}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-sm">
        Processing description
        <textarea className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={3} value={processing} onChange={(event) => setProcessing(event.target.value)} required minLength={10} />
      </label>
      <label className="mt-4 block text-sm">
        Derived file
        <input className="mt-1 block w-full text-sm" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
      </label>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>Store artifact</button>
        <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

function FindingForm({
  request,
  onClose,
  onCreated,
  onError,
}: {
  request: ForensicRequestDetail;
  onClose: () => void;
  onCreated: (updated: ForensicRequestDetail) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [findingType, setFindingType] = useState("OBSERVATION");
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await apiFetch<ForensicRequestDetail>(`/api/forensic-requests/${request.id}/findings`, {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          finding_type: findingType,
          artifact_ids: artifactIds,
        }),
      });
      await onCreated(updated);
    } catch (caught) {
      onError(caught instanceof ApiClientError ? caught.message : "The finding was refused.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-white p-6">
      <h3 className="text-base font-semibold">Add finding</h3>
      <label className="mt-4 block text-sm">
        Title
        <input className="mt-1 w-full rounded-md border border-line px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} />
      </label>
      <label className="mt-4 block text-sm">
        Type
        <select className="mt-1 w-full rounded-md border border-line px-3 py-2" value={findingType} onChange={(event) => setFindingType(event.target.value)}>
          {FINDING_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-sm">
        Description
        <textarea className="mt-1 w-full rounded-md border border-line px-3 py-2" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} required minLength={10} />
      </label>
      <fieldset className="mt-4">
        <legend className="text-sm">Supporting artifacts</legend>
        {request.artifacts.length === 0 ? <p className="mt-2 text-sm text-muted">Create a derived artifact first.</p> : null}
        {request.artifacts.map((item) => (
          <label key={item.id} className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={artifactIds.includes(item.id)}
              onChange={(event) => {
                setArtifactIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id));
              }}
            />
            {item.artifact_number} · {item.title}
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white" disabled={busy}>Save finding</button>
        <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

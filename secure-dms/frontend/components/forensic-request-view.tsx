"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiClientError, apiFetch, uploadWithProgress } from "@/lib/api";
import { artifactTypeLabel, evidenceTypeLabel, forensicStatusLabel, forensicTypeLabel, formatTimestamp } from "@/lib/format";
import type { ArtifactSummary, DirectoryUser, ForensicRequestDetail } from "@/lib/types";

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
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mb-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold tracking-widest text-purple-600 uppercase">Forensic Examination Request</p>
          <span className="text-sm font-medium text-slate-500 font-mono">{record.request_number}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="mt-1 text-3xl font-bold text-slate-900 tracking-tight">{forensicTypeLabel(record.request_type)}</h2>
            <p className="mt-2 text-sm text-slate-600">
              <Link href={`/cases/${record.case_id}`} className="text-blue-600 hover:underline font-medium">{record.case_number}</Link>
              <span> · {record.case_title}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium border ${
                record.status === 'COMPLETED' ? 'bg-green-50 text-green-800 border-green-200' :
                record.status === 'FAILED' ? 'bg-red-50 text-red-800 border-red-200' :
                record.status === 'PENDING_APPROVAL' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                'bg-purple-50 text-purple-800 border-purple-200'
              }`}>{forensicStatusLabel(record.status)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {record.allowed_actions.includes("APPROVE") ? (
              <button type="button" className="rounded-md bg-purple-600 hover:bg-purple-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => post(`/api/forensic-requests/${record.id}/approve`).then((updated) => updated && setNotice("Request approved."))}>Approve Request</button>
            ) : null}
            {record.allowed_actions.includes("START") ? (
              <button type="button" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm flex items-center gap-2" onClick={() => post(`/api/forensic-requests/${record.id}/start`).then((updated) => updated && setNotice("Examination started. The original evidence remains read-only."))}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Begin Examination
              </button>
            ) : null}
            {record.allowed_actions.includes("CREATE_ARTIFACT") ? (
              <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={() => setArtifactOpen(true)}>Create Derived Artifact</button>
            ) : null}
            {record.allowed_actions.includes("ADD_FINDING") ? (
              <button type="button" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm" onClick={() => setFindingOpen(true)}>Log Finding</button>
            ) : null}
            {record.allowed_actions.includes("SUBMIT_REVIEW") ? (
              <button type="button" className="rounded-md bg-purple-600 hover:bg-purple-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => post(`/api/forensic-requests/${record.id}/submit-review`).then((updated) => updated && setNotice("Submitted for review."))}>Submit for Review</button>
            ) : null}
            {record.allowed_actions.includes("REVIEW") ? (
              <button type="button" className="rounded-md bg-green-600 hover:bg-green-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => post(`/api/forensic-requests/${record.id}/review`, { decision: "ACCEPT", comment: "Findings and provenance accepted." }).then((updated) => updated && setNotice("Review accepted. The request is completed."))}>Accept Results</button>
            ) : null}
          </div>
        </div>
      </header>
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{notice}</p> : null}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: Technical Lab Report & Findings */}
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-0 shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 p-4 px-6">
               <h3 className="text-sm font-bold tracking-widest text-slate-500 uppercase flex items-center gap-2">
                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                 Lab Results & Findings
               </h3>
            </div>
            <div className="p-6">
              {record.findings.length === 0 ? <p className="text-sm text-slate-500 italic">No findings have been recorded in this report yet.</p> : (
                <ul className="space-y-4 text-sm">
                  {record.findings.map((item) => (
                    <li key={item.id} className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-bold text-slate-900">{item.title}</p>
                        <span className="font-mono text-xs text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">{item.finding_number}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-medium">{item.finding_type}</span>
                        <span className="inline-flex rounded-full bg-slate-200 text-slate-700 px-2 py-0.5 text-xs font-medium">{item.status}</span>
                        <span className="text-xs text-slate-500 ml-2">Logged by {item.created_by_name}</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed bg-white p-3 rounded border border-slate-100">{item.description}</p>
                      {item.artifact_numbers.length > 0 ? <p className="mt-3 text-xs font-medium text-slate-500">Supported by: <span className="font-mono text-slate-700">{item.artifact_numbers.join(", ")}</span></p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-4 flex items-center gap-2">
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
               Derived Artifacts
            </h3>
            {record.artifacts.length === 0 ? <p className="text-sm text-slate-500 italic">No artifacts have been produced for this request.</p> : (
              <ul className="space-y-3 text-sm">
                {record.artifacts.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-4 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                       <div>
                         <p className="font-semibold text-slate-900">{item.title}</p>
                         <p className="text-xs font-mono text-slate-500 mt-0.5">{item.artifact_number}</p>
                       </div>
                       <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-200">{artifactTypeLabel(item.artifact_type)}</span>
                    </div>
                    <div className="text-xs text-slate-500 flex gap-4">
                       <span>By: {item.created_by_name}</span>
                       <span>Date: {formatTimestamp(item.created_at)}</span>
                    </div>
                    <p className="text-slate-700 bg-slate-50 p-2 rounded border border-slate-100 text-xs">{item.processing_description}</p>
                    <div className="flex items-center justify-between mt-1 pt-3 border-t border-slate-100">
                       <p className="font-mono text-[10px] text-slate-400 break-all w-2/3">SHA-256: {item.sha256_hash}</p>
                       <Link href={`/artifacts/${item.id}`} className="text-blue-600 hover:underline font-medium text-xs">Open Artifact</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: Instructions, Evidence, Assignments */}
        <div className="lg:col-span-1 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
             <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-4">Request Scope</h3>
             
             <div className="mb-4">
                <p className="text-xs text-slate-500 mb-1">Reason for Request</p>
                <p className="text-sm text-slate-900 leading-relaxed font-medium bg-slate-50 p-3 rounded border border-slate-100">{record.reason}</p>
             </div>
             
             <div className="mb-4">
                <p className="text-xs text-slate-500 mb-1">Examiner Instructions</p>
                <p className="text-sm text-slate-900 leading-relaxed bg-amber-50 p-3 rounded border border-amber-100">{record.instructions}</p>
             </div>

             <div className="space-y-3 border-t border-slate-100 pt-4 mt-2">
                <div>
                   <p className="text-xs text-slate-500 mb-0.5">Requested By</p>
                   <p className="text-sm font-medium text-slate-900">{record.requested_by_name}</p>
                   <p className="text-xs text-slate-500">{formatTimestamp(record.requested_at)}</p>
                </div>
                <div>
                   <p className="text-xs text-slate-500 mb-0.5">Assigned Examiner</p>
                   <p className="text-sm font-medium text-slate-900">{record.assigned_to_name ?? "Unassigned"}</p>
                </div>
                {record.approved_by_name ? (
                   <div>
                      <p className="text-xs text-slate-500 mb-0.5">Approved By</p>
                      <p className="text-sm font-medium text-slate-900">{record.approved_by_name}</p>
                      <p className="text-xs text-slate-500">{record.approved_at ? formatTimestamp(record.approved_at) : ""}</p>
                   </div>
                ) : null}
                {record.rejection_reason ? (
                   <div className="bg-red-50 p-3 rounded border border-red-100">
                      <p className="text-xs font-bold text-red-700 mb-0.5">Rejection Reason</p>
                      <p className="text-sm text-red-900">{record.rejection_reason}</p>
                   </div>
                ) : null}
                {record.review_comment ? (
                   <div className="bg-purple-50 p-3 rounded border border-purple-100">
                      <p className="text-xs font-bold text-purple-700 mb-0.5">Review Comment</p>
                      <p className="text-sm text-purple-900">{record.review_comment}</p>
                   </div>
                ) : null}
             </div>
          </section>

          {record.allowed_actions.includes("ASSIGN") ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-3">Assign Examiner</h3>
              <select className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:ring-blue-500 focus:border-blue-500" value={examinerId} onChange={(event) => setExaminerId(event.target.value)}>
                <option value="">Choose an examiner...</option>
                {examiners.map((person) => (
                  <option key={person.id} value={person.id}>{person.full_name}</option>
                ))}
              </select>
              <button type="button" className="mt-3 w-full rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => post(`/api/forensic-requests/${record.id}/assign`, { examiner_id: examinerId }).then((updated) => updated && setNotice("Examiner assigned."))}>Assign Task</button>
            </section>
          ) : null}
          
          {record.allowed_actions.includes("REJECT") ? (
            <section className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
              <h3 className="text-sm font-semibold tracking-wider text-red-700 uppercase mb-3">Reject Request</h3>
              <textarea className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:ring-red-500 focus:border-red-500" rows={3} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Reason for rejection..." />
              <button type="button" className="mt-3 w-full rounded-md bg-red-600 hover:bg-red-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => post(`/api/forensic-requests/${record.id}/reject`, { reason: rejectReason }).then((updated) => updated && setNotice("Request rejected."))}>Reject Request</button>
            </section>
          ) : null}
          
          {record.allowed_actions.includes("REVIEW") ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
              <h3 className="text-sm font-semibold tracking-wider text-amber-700 uppercase mb-3">Return for Correction</h3>
              <textarea className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:ring-amber-500 focus:border-amber-500" rows={3} value={returnComment} onChange={(event) => setReturnComment(event.target.value)} placeholder="Correction details are required..." />
              <button type="button" className="mt-3 w-full rounded-md bg-amber-600 hover:bg-amber-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm" onClick={() => post(`/api/forensic-requests/${record.id}/review`, { decision: "RETURN", comment: returnComment }).then((updated) => updated && setNotice("Returned to the examiner."))}>Return to Examiner</button>
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-4">Target Evidence</h3>
            <ul className="space-y-3">
              {record.evidence.map((item) => (
                <li key={item.id} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
                  <p className="font-semibold text-slate-900 text-sm mb-0.5">{item.title}</p>
                  <p className="font-mono text-xs text-slate-500 mb-2">{item.evidence_number}</p>
                  <div className="flex gap-2 text-[10px] uppercase font-bold text-slate-500 mb-2">
                    <span className="bg-slate-200 px-1.5 py-0.5 rounded">{evidenceTypeLabel(item.evidence_type)}</span>
                    <span className="bg-slate-200 px-1.5 py-0.5 rounded">{item.status}</span>
                  </div>
                  <p className="text-xs text-slate-700 bg-white p-2 border border-slate-100 rounded mb-2">{item.purpose}</p>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 mt-2">
                     <p className="font-mono text-[9px] text-slate-400 break-all w-2/3">SHA-256: {item.sha256_hash}</p>
                     <Link href={`/evidence/${item.id}`} className="text-blue-600 hover:underline font-medium text-xs">View</Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>

        </div>
      </div>
      {artifactOpen ? (
        <ArtifactForm
          request={record}
          onClose={() => setArtifactOpen(false)}
          onCreated={async (scanNotice) => {
            setArtifactOpen(false);
            setNotice(scanNotice ? `Derived artifact stored. ${scanNotice}` : "Derived artifact stored. The original evidence was not changed.");
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
  onCreated: (notice: string | null) => Promise<void>;
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
      const created = await uploadWithProgress<ArtifactSummary>(`/api/forensic-requests/${request.id}/artifacts`, form, () => undefined);
      await onCreated(created.security_scan_message ?? null);
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

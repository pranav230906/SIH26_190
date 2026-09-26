"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { downloadFile } from "@/components/evidence-view";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch } from "@/lib/api";
import { artifactTypeLabel, formatFileSize, formatTimestamp } from "@/lib/format";
import type { ArtifactSummary, IntegrityResult } from "@/lib/types";

export function ArtifactDetailView() {
  const params = useParams<{ artifactId: string }>();
  const { permissions } = usePermissions();
  const [record, setRecord] = useState<ArtifactSummary | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDownload = can(permissions, "DERIVED_ARTIFACT.DOWNLOAD");

  useEffect(() => {
    let cancelled = false;
    apiFetch<ArtifactSummary>(`/api/artifacts/${params.artifactId}`)
      .then((data) => {
        if (!cancelled) setRecord(data);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof ApiClientError && caught.status === 404) {
          setMissing(true);
          return;
        }
        setError(caught instanceof ApiClientError ? caught.message : "The artifact could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [params.artifactId]);

  async function verify() {
    try {
      setIntegrity(await apiFetch<IntegrityResult>(`/api/artifacts/${params.artifactId}/integrity`));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The integrity check could not be completed.");
    }
  }

  if (missing) return <p className="text-sm text-muted">Derived artifact not found.</p>;
  if (!record) return <p className="text-sm text-muted">{error ?? "Loading artifact"}</p>;

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-line bg-white p-6">
        <p className="text-xs font-medium tracking-wide text-brass">DERIVED ARTIFACT</p>
        <p className="mt-2 text-sm text-muted">Source evidence remains the original record.</p>
        <h2 className="mt-2 text-2xl font-semibold text-navy">{record.title}</h2>
        <p className="mt-1 text-sm">{record.artifact_number} · {artifactTypeLabel(record.artifact_type)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/evidence/${record.source_evidence_id}`} className="rounded-md border border-line px-3 py-2 text-sm">View source evidence</Link>
          {canDownload ? (
            <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => downloadFile(`/api/artifacts/${record.id}/download`, setError)}>
              Download
            </button>
          ) : null}
          <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={verify}>Verify integrity</button>
        </div>
      </header>
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      <section className="rounded-lg border border-line bg-white p-6 text-sm">
        <p className="text-muted">Processing</p>
        <p className="mt-1">{record.processing_description}</p>
        <p className="mt-4 text-muted">Created by</p>
        <p className="mt-1">{record.created_by_name} · {formatTimestamp(record.created_at)}</p>
        <p className="mt-4 text-muted">File</p>
        <p className="mt-1">{record.mime_type} · {formatFileSize(record.file_size)}</p>
        <p className="mt-4 text-muted">{record.hash_algorithm}</p>
        <p className="mt-1 break-all font-mono">{record.sha256_hash}</p>
        <p className="mt-4">Integrity: {integrity?.integrity_status ?? "Not checked yet"}</p>
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { can, usePermissions } from "@/components/session-context";
import { ApiClientError, apiFetch } from "@/lib/api";

type PackageItem = {
  id: string;
  item_type: string;
  label: string;
  sha256_hash: string;
  document_id: string | null;
  evidence_id: string | null;
  artifact_id: string | null;
  snapshot: string;
};

type CourtPackage = {
  id: string;
  case_id: string;
  case_number: string;
  package_number: string;
  title: string;
  status: string;
  package_hash: string | null;
  seal_algorithm: string | null;
  seal_value: string | null;
  verification_status: string | null;
  items: PackageItem[];
};

type CaseOption = { id: string; case_number: string; title: string };
type RecordOption = { id: string; label: string };

export function CourtPackagesView() {
  const { permissions } = usePermissions();
  const canCreate = can(permissions, "COURT_PACKAGE.CREATE");
  const canVerify = can(permissions, "COURT_PACKAGE.VERIFY");
  const [packages, setPackages] = useState<CourtPackage[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [caseId, setCaseId] = useState("");
  const [title, setTitle] = useState("");
  const [documents, setDocuments] = useState<RecordOption[]>([]);
  const [evidence, setEvidence] = useState<RecordOption[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const response = await apiFetch<{ items: CourtPackage[] }>("/api/court-packages");
    setPackages(response.items);
  }

  useEffect(() => {
    refresh().catch((caught) => setError(caught instanceof ApiClientError ? caught.message : "Court packages could not be loaded."));
    if (canCreate) {
      apiFetch<{ items: CaseOption[] }>("/api/cases?page_size=100")
        .then((response) => setCases(response.items))
        .catch(() => setCases([]));
    }
  }, [canCreate]);

  useEffect(() => {
    if (!caseId) {
      setDocuments([]);
      setEvidence([]);
      return;
    }
    apiFetch<{ items: { id: string; document_number: string; title: string }[] }>(`/api/cases/${caseId}/documents?page_size=100`)
      .then((response) => setDocuments(response.items.map((item) => ({ id: item.id, label: `${item.document_number} ${item.title}` }))))
      .catch(() => setDocuments([]));
    apiFetch<{ items: { id: string; evidence_number: string; title: string }[] }>(`/api/cases/${caseId}/evidence?page_size=100`)
      .then((response) => setEvidence(response.items.map((item) => ({ id: item.id, label: `${item.evidence_number} ${item.title}` }))))
      .catch(() => setEvidence([]));
  }, [caseId]);

  function toggle(list: string[], id: string, setter: (value: string[]) => void) {
    setter(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  return (
    <div className="grid gap-6">
      {error ? <p className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm text-navy">{notice}</p> : null}

      {canCreate ? (
        <form
          className="grid gap-3 rounded-lg border border-line bg-white p-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            try {
              const created = await apiFetch<CourtPackage>(`/api/cases/${caseId}/court-packages`, {
                method: "POST",
                body: JSON.stringify({
                  title,
                  document_ids: selectedDocuments,
                  evidence_ids: selectedEvidence,
                  artifact_ids: [],
                }),
              });
              await apiFetch(`/api/court-packages/${created.id}/submit`, { method: "POST" });
              setTitle("");
              setSelectedDocuments([]);
              setSelectedEvidence([]);
              setNotice(`${created.package_number} was submitted.`);
              await refresh();
            } catch (caught) {
              setError(caught instanceof ApiClientError ? caught.message : "The package could not be created.");
            }
          }}
        >
          <h2 className="text-base font-semibold">Build a package</h2>
          <p className="text-sm text-muted">Only records you can already read are accepted. Submission stores their hashes, custody, and approval history.</p>
          <label className="text-sm">
            Case
            <select required value={caseId} onChange={(event) => setCaseId(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
              <option value="">Select a case</option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.case_number} {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Title
            <input required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
          </label>
          <fieldset className="grid gap-2 text-sm">
            <legend className="font-medium">Documents</legend>
            {documents.map((item) => (
              <label key={item.id} className="flex items-center gap-2">
                <input type="checkbox" checked={selectedDocuments.includes(item.id)} onChange={() => toggle(selectedDocuments, item.id, setSelectedDocuments)} />
                {item.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid gap-2 text-sm">
            <legend className="font-medium">Evidence</legend>
            {evidence.map((item) => (
              <label key={item.id} className="flex items-center gap-2">
                <input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={() => toggle(selectedEvidence, item.id, setSelectedEvidence)} />
                {item.label}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">
            Submit package
          </button>
        </form>
      ) : null}

      <section className="grid gap-4">
        {packages.map((item) => (
          <article key={item.id} className="rounded-lg border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{item.package_number}</h3>
                <p className="text-sm text-muted">{item.case_number} · {item.title}</p>
              </div>
              <p className="text-sm font-medium">{item.verification_status ?? item.status}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Algorithm: {item.seal_algorithm ?? "Not sealed"}</span>
              {item.seal_value ? (
                <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  Judicial Seal Verified
                </span>
              ) : null}
            </div>
            {item.seal_value ? (
              <p className="mt-1 break-all font-mono text-xs text-navy">
                Seal: {item.seal_value}
              </p>
            ) : null}
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Package Items ({item.items.length})
              </h4>
              <ul className="grid gap-2 text-sm">
                {item.items.map((entry) => (
                  <li key={entry.id} className="rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-line/60 px-1.5 py-0.5 text-xs font-semibold uppercase text-navy">
                          {entry.item_type}
                        </span>
                        <span className="font-medium text-navy">{entry.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.document_id ? (
                          <Link
                            href={`/documents/${entry.document_id}`}
                            className="rounded border border-line px-2 py-1 text-xs text-navy hover:bg-line/20"
                          >
                            View document
                          </Link>
                        ) : null}
                        {entry.evidence_id ? (
                          <Link
                            href={`/evidence/${entry.evidence_id}`}
                            className="rounded border border-line px-2 py-1 text-xs text-navy hover:bg-line/20"
                          >
                            View evidence
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-muted">
                      Hash: {entry.sha256_hash}
                    </p>
                    {entry.snapshot ? (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-medium text-navy hover:underline">
                          Inspect frozen snapshot (custody & provenance)
                        </summary>
                        <pre className="mt-2 max-h-60 overflow-auto rounded bg-[#f6f7f8] p-2 text-xs text-navy">
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(entry.snapshot), null, 2);
                            } catch {
                              return entry.snapshot;
                            }
                          })()}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            {canVerify ? (
              <button
                type="button"
                className="mt-4 rounded-md border border-line px-3 py-2 text-sm"
                onClick={async () => {
                  setError("");
                  try {
                    const result = await apiFetch<{ verification_status: string; mismatches: string[] }>(`/api/court-packages/${item.id}/verify`, { method: "POST" });
                    setNotice(
                      result.mismatches.length
                        ? `${item.package_number} mismatch: ${result.mismatches.join(", ")}`
                        : `${item.package_number} verified.`,
                    );
                    await refresh();
                  } catch (caught) {
                    setError(caught instanceof ApiClientError ? caught.message : "Verification failed.");
                  }
                }}
              >
                Verify package
              </button>
            ) : null}
          </article>
        ))}
        {packages.length === 0 ? <p className="text-sm text-muted">No court packages are available.</p> : null}
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SEARCH_DOCUMENT_TYPES } from "@/lib/format";
import { ApiClientError, apiFetch } from "@/lib/api";
import type { CaseListResponse, DepartmentRecord, SearchResponse, SearchResult, SearchSuggestion } from "@/lib/types";

const DOCUMENT_TYPES = SEARCH_DOCUMENT_TYPES;

const MATCH_LABEL: Record<string, string> = {
  LEXICAL: "Exact keyword",
  SEMANTIC: "Semantic",
  HYBRID: "Hybrid",
  METADATA: "Metadata",
};

export function SearchView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [caseId, setCaseId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [fileType, setFileType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [matchType, setMatchType] = useState("");
  const [includePrevious, setIncludePrevious] = useState(false);
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [includeOcr, setIncludeOcr] = useState(true);
  const [cases, setCases] = useState<CaseListResponse["items"]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<CaseListResponse>("/api/cases?page=1&page_size=100")
      .then((data) => setCases(data.items))
      .catch(() => setCases([]));
    apiFetch<{ items: DepartmentRecord[] }>("/api/departments")
      .then((data) => setDepartments(data.items))
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      apiFetch<{ suggestions: SearchSuggestion[] }>(`/api/search/suggest?q=${encodeURIComponent(term)}`)
        .then((data) => setSuggestions(data.suggestions))
        .catch(() => setSuggestions([]));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestions([]);
    const params = new URLSearchParams({ q: term, mode });
    if (caseId) params.set("case_id", caseId);
    if (documentType) params.set("document_type", documentType);
    if (departmentId) params.set("department_id", departmentId);
    if (fileType.trim()) params.set("file_type", fileType.trim());
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (matchType) params.set("match_type", matchType);
    if (includePrevious) params.set("include_previous", "true");
    if (!includeEvidence) params.set("include_evidence", "false");
    if (!includeOcr) params.set("include_ocr", "false");
    try {
      const data = await apiFetch<SearchResponse>(`/api/search?${params.toString()}`);
      setResponse(data);
    } catch (caught) {
      setResponse(null);
      setError(caught instanceof ApiClientError ? caught.message : "Search could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function openResult(item: SearchResult) {
    try {
      await apiFetch("/api/search/opened", {
        method: "POST",
        body: JSON.stringify({
          document_id: item.document_id,
          evidence_id: item.type === "artifact" ? null : item.evidence_id,
          artifact_id: item.artifact_id,
        }),
      });
    } catch {
      // The destination page enforces access again.
    }
    if (item.artifact_id) {
      router.push(`/artifacts/${item.artifact_id}`);
      return;
    }
    if (item.type === "evidence" && item.evidence_id) {
      router.push(`/evidence/${item.evidence_id}`);
      return;
    }
    if (item.document_id) {
      const params = new URLSearchParams();
      if (item.page_number) params.set("page", String(item.page_number));
      if (item.version_id) params.set("version", item.version_id);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      router.push(`/documents/${item.document_id}${suffix}`);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-white p-6">
        <label className="block text-sm font-medium text-navy">
          Search case files, FIR numbers, evidence, names
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-2 w-full rounded-md border border-line px-3 py-2 text-base font-normal text-ink"
            placeholder="Search case files, FIR numbers, evidence, names..."
          />
        </label>
        {suggestions.length > 0 ? (
          <ul className="rounded-md border border-line bg-white text-sm">
            {suggestions.map((item) => (
              <li key={`${item.kind}-${item.href}`}>
                <button type="button" className="block w-full px-3 py-2 text-left hover:bg-paper" onClick={() => router.push(item.href)}>
                  <span className="text-muted">{item.kind}</span> {item.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Mode" value={mode} onChange={setMode}>
            <option value="hybrid">Hybrid</option>
            <option value="lexical">Exact keyword</option>
            <option value="semantic">Semantic</option>
          </Select>
          <Select label="Case" value={caseId} onChange={setCaseId}>
            <option value="">All accessible cases</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.case_number}
              </option>
            ))}
          </Select>
          <Select label="Document type" value={documentType} onChange={setDocumentType}>
            <option value="">Any</option>
            {DOCUMENT_TYPES.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
          <Select label="Department" value={departmentId} onChange={setDepartmentId}>
            <option value="">Any</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <label className="block text-sm">
            File type
            <input value={fileType} onChange={(event) => setFileType(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" placeholder="pdf, png, text/plain" />
          </label>
          <Select label="Match type" value={matchType} onChange={setMatchType}>
            <option value="">Any</option>
            <option value="LEXICAL">Exact keyword</option>
            <option value="SEMANTIC">Semantic</option>
            <option value="HYBRID">Hybrid</option>
            <option value="METADATA">Metadata</option>
          </Select>
          <label className="block text-sm">
            From
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
          </label>
          <label className="block text-sm">
            To
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2" />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includePrevious} onChange={(event) => setIncludePrevious(event.target.checked)} />
            Include previous versions
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)} />
            Search evidence
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeOcr} onChange={(event) => setIncludeOcr(event.target.checked)} />
            Search OCR text
          </label>
        </div>
        <button type="submit" disabled={busy} className="rounded-md bg-navy px-4 py-2 text-sm text-white">
          {busy ? "Searching" : "Search"}
        </button>
      </form>

      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {response?.message ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm">{response.message}</p> : null}

      {response ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-navy">Search results</h2>
          <p className="text-sm text-muted">{response.total} result{response.total === 1 ? "" : "s"}</p>
          {response.results.length === 0 ? <p className="text-sm text-muted">No results.</p> : null}
          {response.results.map((item) => (
            <article key={`${item.type}-${item.document_id ?? item.artifact_id ?? item.evidence_id}-${item.page_number ?? 0}-${item.version_id ?? ""}`} className="rounded-lg border border-line bg-white p-5">
              <h3 className="text-base font-semibold text-navy">{item.title}</h3>
              <p className="mt-1 text-sm text-muted">{item.case_number}</p>
              {item.page_number ? <p className="mt-2 text-sm">Page {item.page_number}</p> : null}
              {item.version_label ? <p className="text-sm text-muted">{item.version_label}</p> : null}
              <p className="mt-3 text-sm">&quot;{item.snippet}&quot;</p>
              <p className="mt-3 text-sm">
                Match: {MATCH_LABEL[item.match_type] ?? item.match_type}
                {item.artifact_number ? ` · ${item.artifact_number}` : ""}
                {item.source_evidence_id && item.type === "artifact" ? " · source evidence retained" : ""}
              </p>
              <button type="button" className="mt-4 rounded-md bg-navy px-3 py-2 text-sm text-white" onClick={() => openResult(item)}>
                Open
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
        {children}
      </select>
    </label>
  );
}

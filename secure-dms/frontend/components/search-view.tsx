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
    <div className="space-y-8">
      <div className="bg-slate-900 rounded-xl p-8 shadow-md text-white border-b-4 border-blue-600 flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold uppercase tracking-wide flex items-center gap-3">
             <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
             Global Intelligence Search
          </h2>
          <p className="mt-2 text-slate-400 font-medium">
            Unified query interface for case files, operational data, and forensic evidence.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-6 bg-slate-50 border-b border-slate-200 space-y-4">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block mb-2">Search Query</span>
              <div className="relative">
                <svg className="w-6 h-6 absolute left-4 top-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded-lg border-2 border-blue-200 pl-12 pr-4 py-3 text-lg font-mono text-slate-900 focus:border-blue-600 focus:ring-0 outline-none transition-colors shadow-sm bg-white"
                  placeholder="Enter FIR numbers, subject names, or keywords..."
                />
              </div>
            </label>
            {suggestions.length > 0 ? (
              <ul className="rounded-lg border border-slate-200 bg-white text-sm shadow-md mt-1 divide-y divide-slate-100 overflow-hidden relative z-10">
                {suggestions.map((item) => (
                  <li key={`${item.kind}-${item.href}`}>
                    <button type="button" className="block w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors focus:bg-blue-50 outline-none" onClick={() => router.push(item.href)}>
                      <span className="inline-block w-24 text-xs font-bold uppercase tracking-wider text-blue-600">{item.kind}</span>
                      <span className="font-medium text-slate-900">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
        </div>
        
        <div className="p-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 bg-white">
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
          <Select label="File Extension" value={fileType} onChange={setFileType}>
             <option value="">Any Format</option>
             <option value="pdf">PDF Document (.pdf)</option>
             <option value="png">Image (.png)</option>
             <option value="jpeg">Image (.jpg, .jpeg)</option>
             <option value="text/plain">Plain Text (.txt)</option>
          </Select>
          <Select label="Match Algorithm" value={matchType} onChange={setMatchType}>
            <option value="">Auto-Detect</option>
            <option value="LEXICAL">Exact Keyword (Lexical)</option>
            <option value="SEMANTIC">AI Context (Semantic)</option>
            <option value="HYBRID">Hybrid (Combined)</option>
            <option value="METADATA">Metadata Tags Only</option>
          </Select>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">Date Range (Start)</label>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">Date Range (End)</label>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors" />
          </div>
        </div>
        
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-6">
            <div className="flex flex-wrap gap-6 text-sm font-medium text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer hover:text-blue-700 transition-colors">
                <input type="checkbox" checked={includePrevious} onChange={(event) => setIncludePrevious(event.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                Include Legacy Revisions
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:text-blue-700 transition-colors">
                <input type="checkbox" checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                Index Raw Evidence Vault
              </label>
              <label className="flex items-center gap-2 cursor-pointer hover:text-blue-700 transition-colors">
                <input type="checkbox" checked={includeOcr} onChange={(event) => setIncludeOcr(event.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                Extract OCR Text
              </label>
            </div>
            <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors px-8 py-2.5 text-sm font-bold text-white shadow-sm inline-flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              {busy ? "Querying..." : "Execute Search"}
            </button>
        </div>
      </form>

      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-red-800 text-sm font-medium shadow-sm">
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> {error}
        </div>
      ) : null}
      
      {response?.message ? (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 flex items-center gap-3 text-blue-800 text-sm font-medium shadow-sm">
          <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> {response.message}
        </div>
      ) : null}

      {response ? (
        <section className="space-y-6">
          <div className="flex items-center justify-between border-b-2 border-slate-200 pb-2">
             <h2 className="text-xl font-bold uppercase tracking-wide text-slate-800">Intelligence Report</h2>
             <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border border-slate-200">
               {response?.total} match{response?.total === 1 ? "" : "es"}
             </span>
          </div>
          
          {response?.results?.length === 0 ? (
            <div className="py-16 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
               <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">No intelligence found matching query parameters.</p>
            </div>
          ) : null}
          
          <div className="grid gap-4">
            {response?.results?.map((item) => (
              <article key={`${item.type}-${item.document_id ?? item.artifact_id ?? item.evidence_id}-${item.page_number ?? 0}-${item.version_id ?? ""}`} className="relative rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow group flex flex-col md:flex-row gap-6">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500 rounded-l-xl"></div>
                
                <div className="flex-1 space-y-3 pl-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                     <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-700 transition-colors cursor-pointer" onClick={() => openResult(item)}>
                       {item.title}
                     </h3>
                     <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider border border-blue-200">
                       {item.type}
                     </span>
                  </div>
                  
                  <div className="flex flex-wrap gap-3 text-xs font-medium text-slate-500 font-mono">
                    <span className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      {item.case_number}
                    </span>
                    {item.page_number ? (
                      <span className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                         PG. {item.page_number}
                      </span>
                    ) : null}
                    {item.version_label ? (
                      <span className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                         {item.version_label}
                      </span>
                    ) : null}
                    {item.artifact_number ? (
                      <span className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                         {item.artifact_number}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded border border-green-200">
                       {MATCH_LABEL[item.match_type] ?? item.match_type} MATCH
                    </span>
                  </div>
                  
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 font-mono text-sm text-slate-700 leading-relaxed relative">
                     <span className="absolute top-2 left-2 text-slate-300">
                       <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h4v10h-10z"/></svg>
                     </span>
                     <div className="pl-6">&quot;{item.snippet}&quot;</div>
                  </div>
                  
                  {item.source_evidence_id && item.type === "artifact" ? (
                    <p className="text-xs text-amber-600 font-medium flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Source evidence retained in vault.
                    </p>
                  ) : null}
                </div>
                
                <div className="md:w-32 flex flex-col justify-center items-end shrink-0 pl-2">
                  <button type="button" className="w-full text-center rounded-lg bg-slate-900 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-bold text-white shadow-sm" onClick={() => openResult(item)}>
                    Access
                  </button>
                </div>
              </article>
            ))}
          </div>
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
    <label className="block space-y-1">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors">
        {children}
      </select>
    </label>
  );
}

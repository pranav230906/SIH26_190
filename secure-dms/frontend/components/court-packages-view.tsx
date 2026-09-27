"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const caseIdParam = searchParams.get("case_id") || "";
  const { permissions } = usePermissions();
  const canCreate = can(permissions, "COURT_PACKAGE.CREATE");
  const canVerify = can(permissions, "COURT_PACKAGE.VERIFY");
  const [packages, setPackages] = useState<CourtPackage[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [caseId, setCaseId] = useState(caseIdParam);
  const [title, setTitle] = useState("");
  const [documents, setDocuments] = useState<RecordOption[]>([]);
  const [evidence, setEvidence] = useState<RecordOption[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (caseIdParam) {
      setCaseId(caseIdParam);
    }
  }, [caseIdParam]);

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
          className="grid gap-6 rounded-sm border-2 border-slate-900 bg-[#fdfdfc] p-8 shadow-sm relative overflow-hidden"
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
          <div className="absolute top-0 left-0 w-full h-2 bg-slate-900"></div>
          <div className="text-center mb-4">
             <h2 className="text-3xl font-serif font-bold text-slate-900 uppercase tracking-widest border-b-2 border-slate-900 inline-block pb-2">Judicial Export Preparation</h2>
             <p className="text-sm font-serif text-slate-600 mt-4 max-w-2xl mx-auto italic">Official court packages compile selected case documents and forensic evidence into a cryptographically sealed archive. Only immutable, authenticated records may be attached.</p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 border-t border-b border-slate-300 py-6">
            <div className="space-y-4">
               <label className="block text-sm font-bold uppercase tracking-wider text-slate-900 font-sans">
                 Source Case Reference
                 <select required value={caseId} onChange={(event) => setCaseId(event.target.value)} className="mt-2 w-full rounded-sm border-2 border-slate-400 bg-white px-3 py-2 font-serif focus:border-slate-900 focus:ring-0">
                   <option value="">Select a verified case</option>
                   {cases.map((item) => (
                     <option key={item.id} value={item.id}>
                       {item.case_number} - {item.title}
                     </option>
                   ))}
                 </select>
               </label>
               <label className="block text-sm font-bold uppercase tracking-wider text-slate-900 font-sans">
                 Official Package Title
                 <input required minLength={3} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g., State v. Doe - Initial Discovery" className="mt-2 w-full rounded-sm border-2 border-slate-400 bg-white px-3 py-2 font-serif focus:border-slate-900 focus:ring-0" />
               </label>
            </div>
            
            <div className="space-y-6">
               <fieldset className="text-sm">
                 <legend className="font-bold uppercase tracking-wider text-slate-900 font-sans mb-3 border-b border-slate-300 w-full pb-1">Verified Documents</legend>
                 <div className="max-h-40 overflow-y-auto pr-2 space-y-2 font-serif">
                   {documents.length === 0 ? <p className="text-slate-500 italic">No approved documents available.</p> : null}
                   {documents.map((item) => (
                     <label key={item.id} className="flex items-start gap-3 cursor-pointer group">
                       <input type="checkbox" className="mt-1 border-slate-400 text-slate-900 focus:ring-slate-900 cursor-pointer" checked={selectedDocuments.includes(item.id)} onChange={() => toggle(selectedDocuments, item.id, setSelectedDocuments)} />
                       <span className="group-hover:text-slate-900 text-slate-700 leading-tight">{item.label}</span>
                     </label>
                   ))}
                 </div>
               </fieldset>
               <fieldset className="text-sm">
                 <legend className="font-bold uppercase tracking-wider text-slate-900 font-sans mb-3 border-b border-slate-300 w-full pb-1">Authenticated Evidence</legend>
                 <div className="max-h-40 overflow-y-auto pr-2 space-y-2 font-serif">
                   {evidence.length === 0 ? <p className="text-slate-500 italic">No authenticated evidence available.</p> : null}
                   {evidence.map((item) => (
                     <label key={item.id} className="flex items-start gap-3 cursor-pointer group">
                       <input type="checkbox" className="mt-1 border-slate-400 text-slate-900 focus:ring-slate-900 cursor-pointer" checked={selectedEvidence.includes(item.id)} onChange={() => toggle(selectedEvidence, item.id, setSelectedEvidence)} />
                       <span className="group-hover:text-slate-900 text-slate-700 leading-tight">{item.label}</span>
                     </label>
                   ))}
                 </div>
               </fieldset>
            </div>
          </div>
          
          <div className="flex justify-center mt-2">
             <button type="submit" className="rounded-sm bg-slate-900 hover:bg-slate-800 transition-colors px-12 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-md flex items-center gap-3">
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
               Seal & Submit Package
             </button>
          </div>
        </form>
      ) : null}

      <section className="grid gap-8 mt-4">
        {packages.map((item) => (
          <article key={item.id} className="rounded-sm border-2 border-slate-300 bg-[#fdfdfc] shadow-lg relative overflow-hidden">
            <div className="bg-slate-900 text-slate-100 p-6 flex flex-wrap items-end justify-between gap-6 border-b-4 border-double border-slate-700">
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Sealed Court Package</p>
                <h3 className="text-3xl font-serif font-bold text-white">{item.package_number}</h3>
                <p className="text-lg font-serif text-slate-300 italic mt-1">{item.case_number} — {item.title}</p>
              </div>
              <div className="text-right">
                <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${item.verification_status?.includes('mismatch') || item.status === 'ERROR' ? 'bg-red-900 text-red-100 border border-red-700' : 'bg-slate-800 text-slate-200 border border-slate-600'}`}>
                  {item.verification_status ?? item.status}
                </span>
                {item.seal_value ? (
                  <div className="mt-4 flex items-center justify-end gap-2 text-green-400">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    <span className="text-sm font-bold uppercase tracking-widest">Judicial Seal Verified</span>
                  </div>
                ) : null}
              </div>
            </div>
            
            <div className="p-8">
              <div className="mb-8 p-4 bg-slate-50 border border-slate-200 rounded-sm">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 font-sans border-b border-slate-200 pb-2">Cryptographic Manifest</h4>
                <div className="grid sm:grid-cols-2 gap-4 text-sm mt-3 font-serif">
                   <div>
                     <span className="text-slate-500 italic block mb-1">Hashing Algorithm</span>
                     <span className="font-mono text-slate-900 font-bold">{item.seal_algorithm ?? "N/A"}</span>
                   </div>
                   <div>
                     <span className="text-slate-500 italic block mb-1">Package Digital Signature</span>
                     {item.seal_value ? (
                        <span className="font-mono text-[10px] break-all text-slate-900 bg-white p-2 border border-slate-200 rounded block">{item.seal_value}</span>
                     ) : (
                        <span className="text-slate-400 italic">Signature pending</span>
                     )}
                   </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900 font-sans border-b-2 border-slate-900 pb-2 flex justify-between">
                  <span>Enclosed Exhibits & Documents</span>
                  <span className="text-slate-500">Count: {item.items.length}</span>
                </h4>
                
                <ul className="space-y-4">
                  {item.items.map((entry) => (
                    <li key={entry.id} className="relative pl-6 before:absolute before:left-0 before:top-2 before:w-2 before:h-2 before:bg-slate-900 before:rounded-sm">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 font-sans border border-slate-300 px-2 py-0.5 rounded-sm bg-white">
                              {entry.item_type}
                            </span>
                            <span className="text-lg font-serif font-bold text-slate-900">{entry.label}</span>
                          </div>
                          <p className="font-mono text-[11px] text-slate-600 mt-2 break-all bg-slate-50 p-1.5 border border-slate-200 rounded-sm inline-block">SHA256: {entry.sha256_hash}</p>
                          
                          {entry.snapshot ? (
                            <details className="mt-3 text-sm group">
                              <summary className="cursor-pointer font-serif italic text-blue-700 hover:text-blue-900 hover:underline select-none">
                                Review Exhibit Provenance & Chain of Custody
                              </summary>
                              <div className="mt-3 border-l-4 border-slate-300 pl-4 py-2">
                                <pre className="max-h-60 overflow-auto bg-slate-900 p-4 text-[10px] text-slate-300 font-mono shadow-inner rounded-sm">
                                  {(() => {
                                    try {
                                      return JSON.stringify(JSON.parse(entry.snapshot), null, 2);
                                    } catch {
                                      return entry.snapshot;
                                    }
                                  })()}
                                </pre>
                              </div>
                            </details>
                          ) : null}
                        </div>
                        
                        <div className="flex flex-col gap-2 shrink-0">
                          {entry.document_id ? (
                            <Link
                              href={`/documents/${entry.document_id}`}
                              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm text-center"
                            >
                              Inspect Document
                            </Link>
                          ) : null}
                          {entry.evidence_id ? (
                            <Link
                              href={`/evidence/${entry.evidence_id}`}
                              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm text-center"
                            >
                              Inspect Evidence
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              
              {canVerify ? (
                <div className="mt-10 border-t-2 border-slate-200 pt-6 text-center">
                   <button
                     type="button"
                     className="rounded-sm bg-slate-100 hover:bg-slate-200 border-2 border-slate-300 transition-colors px-8 py-3 text-sm font-bold uppercase tracking-widest text-slate-700 shadow-sm flex items-center gap-2 mx-auto"
                     onClick={async () => {
                       setError("");
                       try {
                         const result = await apiFetch<{ verification_status: string; mismatches: string[] }>(`/api/court-packages/${item.id}/verify`, { method: "POST" });
                         setNotice(
                           result.mismatches.length
                             ? `${item.package_number} mismatch: ${result.mismatches.join(", ")}`
                             : `${item.package_number} cryptographically verified.`,
                         );
                         await refresh();
                       } catch (caught) {
                         setError(caught instanceof ApiClientError ? caught.message : "Verification failed.");
                       }
                     }}
                   >
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                     Perform Judicial Verification
                   </button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {packages.length === 0 ? (
           <div className="text-center py-16 rounded-sm border-2 border-dashed border-slate-300 bg-slate-50">
             <p className="text-lg font-serif text-slate-500 italic">No official court packages have been compiled.</p>
           </div>
        ) : null}
      </section>
    </div>
  );
}

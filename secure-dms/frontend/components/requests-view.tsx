"use client";

import { useEffect, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";
import type { AccessRequestRecord } from "@/lib/types";
import { can, usePermissions, useSession } from "@/components/session-context";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function RequestsView() {
  const session = useSession();
  const { permissions } = usePermissions();
  const [scope, setScope] = useState<"mine" | "pending" | "active">(can(permissions, "ACCESS_REQUEST.APPROVE") ? "pending" : "mine");
  const [items, setItems] = useState<AccessRequestRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; confirmLabel: string; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [caseNumber, setCaseNumber] = useState("");
  const [justification, setJustification] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    apiFetch<{ items: AccessRequestRecord[] }>(`/api/access-requests?scope=${scope}`)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiClientError ? caught.message : "Requests could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  async function handleCreateCaseRequest(e: React.FormEvent) {
    e.preventDefault();
    setModalError(null);
    setBusy(true);
    try {
      await apiFetch("/api/access-requests/case", {
        method: "POST",
        body: JSON.stringify({
          case_number: caseNumber.trim(),
          justification: justification.trim(),
          emergency,
        }),
      });
      setRequestModalOpen(false);
      setCaseNumber("");
      setJustification("");
      setEmergency(false);
      setNotice("Case access request submitted. Awaiting supervisor review.");
      setScope("mine");
    } catch (caught) {
      setModalError(caught instanceof ApiClientError ? caught.message : "Request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    if (!confirm) {
      return;
    }
    setBusy(true);
    try {
      await confirm.run();
      setConfirm(null);
    } catch (caught: unknown) {
      setConfirm(null);
      setNotice(caught instanceof ApiClientError ? caught.message : "The action could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900 rounded-xl p-6 shadow-md text-white">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
             <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
             Access Request Queue
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Manage operational clearances and temporary access grants for secure records.
          </p>
        </div>
        {can(permissions, "ACCESS_REQUEST.CREATE") ? (
          <button
            type="button"
            className="rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors px-5 py-2.5 text-sm font-bold shadow-sm flex items-center gap-2"
            onClick={() => {
              setModalError(null);
              setRequestModalOpen(true);
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Request Clearance
          </button>
        ) : null}
      </div>

      <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit border border-slate-200">
        {can(permissions, "ACCESS_REQUEST.READ") ? (
          <button
            type="button"
            className={`rounded-md px-6 py-2 text-sm font-bold transition-all ${scope === "mine" ? "bg-white text-blue-700 shadow-sm border border-slate-200/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"}`}
            onClick={() => setScope("mine")}
          >
            My Requests
          </button>
        ) : null}
        {can(permissions, "ACCESS_REQUEST.APPROVE") ? (
          <>
            <button
              type="button"
              className={`rounded-md px-6 py-2 text-sm font-bold transition-all ${scope === "pending" ? "bg-white text-blue-700 shadow-sm border border-slate-200/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"}`}
              onClick={() => setScope("pending")}
            >
              Pending Approvals
            </button>
            <button
              type="button"
              className={`rounded-md px-6 py-2 text-sm font-bold transition-all ${scope === "active" ? "bg-white text-blue-700 shadow-sm border border-slate-200/50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"}`}
              onClick={() => setScope("active")}
            >
              Active Grants
            </button>
          </>
        ) : null}
      </div>
      
      {notice ? <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-center gap-3 text-green-800 text-sm font-medium shadow-sm"><svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg> {notice}</div> : null}
      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-red-800 text-sm font-medium shadow-sm">
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> {error}
        </div>
      ) : null}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {items === null && !error ? <div className="px-6 py-12 flex flex-col items-center justify-center text-slate-400"><svg className="animate-spin h-8 w-8 mb-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p className="font-medium text-sm">Loading requests...</p></div> : null}
        {items && items.length === 0 ? (
           <div className="px-6 py-16 text-center text-slate-500">
             <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
             <p className="text-lg font-medium text-slate-700">No {scope} requests found.</p>
           </div>
        ) : null}
        {items && items.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} className={`p-6 hover:bg-slate-50 transition-colors ${item.status === 'PENDING' ? 'border-l-4 border-l-amber-400' : item.status === 'APPROVED' ? 'border-l-4 border-l-green-500' : item.status === 'REJECTED' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-slate-300'}`}>
                 <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                    <div className="flex-1 space-y-3">
                       <div className="flex items-center gap-3">
                          <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                            item.status === 'PENDING' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                            item.status === 'APPROVED' ? 'bg-green-100 text-green-800 border border-green-200' :
                            item.status === 'REJECTED' ? 'bg-red-100 text-red-800 border border-red-200' :
                            'bg-slate-100 text-slate-800 border border-slate-200'
                          }`}>
                            {item.status}
                          </span>
                          <span className="font-mono text-sm font-bold text-slate-600 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">{item.case_number}</span>
                          <span className="text-sm font-bold text-slate-700 flex items-center gap-1">
                             <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                             {item.requester_username}
                          </span>
                       </div>
                       
                       <div>
                          <p className="text-base font-bold text-slate-900 flex items-center gap-2">
                             Requested: {item.resource_type} {item.requested_action}
                             {item.access_kind === "EMERGENCY" ? (
                               <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-800 border border-red-200">
                                 <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                 Emergency (24h)
                               </span>
                             ) : null}
                          </p>
                          <div className="mt-2 bg-white border border-slate-200 rounded-lg p-3 text-sm text-slate-600 shadow-sm relative before:absolute before:left-3 before:-top-2 before:w-4 before:h-4 before:bg-white before:border-t before:border-l before:border-slate-200 before:transform before:rotate-45">
                             <p className="relative z-10 italic">"{item.justification}"</p>
                          </div>
                       </div>
                       
                       <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
                         <span className="flex items-center gap-1">
                           <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                           Created: {formatTimestamp(item.created_at)}
                         </span>
                         {scope === "active" && item.expires_at ? (
                           <span className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                             Expires: {formatTimestamp(item.expires_at)}
                           </span>
                         ) : null}
                       </div>
                    </div>
                    
                    <div className="flex lg:flex-col gap-3 shrink-0 items-end">
                       {scope === "pending" && item.requester_id === session.id ? (
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-100 px-3 py-1.5 rounded border border-slate-200">Own Request</span>
                       ) : null}
                       
                       {scope === "pending" && item.requester_id !== session.id ? (
                          <>
                             <button
                               type="button"
                               className="w-full sm:w-auto rounded-lg bg-green-600 hover:bg-green-500 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors flex justify-center items-center gap-2"
                               onClick={() =>
                                 setConfirm({
                                   title: "Approve Access Request",
                                   message: `Grant ${item.requested_action} clearance on ${item.resource_type} for officer ${item.requester_username}.`,
                                   confirmLabel: "Approve Clearance",
                                   run: async () => {
                                     await apiFetch(`/api/access-requests/${item.id}/approve`, {
                                       method: "POST",
                                       body: JSON.stringify({ note: "Approved from the request register." }),
                                     });
                                     setItems((current) => (current ?? []).filter((row) => row.id !== item.id));
                                     setNotice("Request approved.");
                                   },
                                 })
                               }
                             >
                               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                               Approve
                             </button>
                             <button
                               type="button"
                               className="w-full sm:w-auto rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 px-6 py-2.5 text-sm font-bold text-red-700 shadow-sm transition-colors flex justify-center items-center gap-2"
                               onClick={() =>
                                 setConfirm({
                                   title: "Reject Access Request",
                                   message: `Deny the request from ${item.requester_username}.`,
                                   confirmLabel: "Reject Request",
                                   run: async () => {
                                     await apiFetch(`/api/access-requests/${item.id}/reject`, {
                                       method: "POST",
                                       body: JSON.stringify({ note: "Rejected from the request register." }),
                                     });
                                     setItems((current) => (current ?? []).filter((row) => row.id !== item.id));
                                     setNotice("Request rejected.");
                                   },
                                 })
                               }
                             >
                               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                               Reject
                             </button>
                          </>
                       ) : null}
                       
                       {scope === "active" ? (
                         <button
                           type="button"
                           className="w-full sm:w-auto rounded-lg border border-red-200 bg-red-50 hover:bg-red-600 hover:text-white px-6 py-2.5 text-sm font-bold text-red-700 shadow-sm transition-colors flex justify-center items-center gap-2"
                           onClick={() =>
                             setConfirm({
                               title: "Revoke Active Clearance",
                               message: `Immediately revoke operational access for ${item.requester_username} on ${item.case_number}.`,
                               confirmLabel: "Revoke Access Now",
                               run: async () => {
                                 await apiFetch(`/api/access-requests/${item.id}/revoke`, {
                                   method: "POST",
                                   body: JSON.stringify({ note: "Access grant revoked early by supervisor." }),
                                 });
                                 setItems((current) => (current ?? []).filter((row) => row.id !== item.id));
                                 setNotice("Access grant successfully revoked.");
                               },
                             })
                           }
                         >
                           <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                           Revoke Clearance
                         </button>
                       ) : null}
                    </div>
                 </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {requestModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-3">
               <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
               <div>
                  <h3 className="text-lg font-bold text-slate-900">Request Case Access</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">Submit operational justification for authorization.</p>
               </div>
            </div>
            
            <div className="p-6">
              {modalError ? (
                <div role="alert" className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                  {modalError}
                </div>
              ) : null}
              <form onSubmit={handleCreateCaseRequest} className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Target Case Number
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. CASE-2026-001"
                    className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-0 outline-none transition-colors"
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Operational Justification
                  </label>
                  <textarea
                    required
                    minLength={10}
                    rows={4}
                    placeholder="Provide official operational or legal reason for accessing this case..."
                    className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-0 outline-none transition-colors"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-red-200 bg-red-50 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={emergency}
                    onChange={(e) => setEmergency(e.target.checked)}
                    className="rounded border-red-300 text-red-600 focus:ring-red-500 cursor-pointer w-5 h-5"
                  />
                  <div>
                     <span className="block text-sm font-bold text-red-800">Urgent / Emergency Access</span>
                     <span className="block text-xs text-red-600 mt-0.5">Request a 24-hour temporary clearance bypassing standard review queues.</span>
                  </div>
                </label>
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-sm font-bold text-slate-700 transition-colors"
                    onClick={() => setRequestModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-blue-600 hover:bg-blue-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors flex items-center gap-2 disabled:opacity-70"
                  >
                    {busy ? (
                       <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Submitting…</>
                    ) : (
                       "Submit Request"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirmed}
      />
    </div>
  );
}

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Access requests</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Approval is decided by the service. A person cannot approve their own request.
          </p>
        </div>
        {can(permissions, "ACCESS_REQUEST.CREATE") ? (
          <button
            type="button"
            className="rounded-md bg-navy px-3 py-1.5 text-sm text-white"
            onClick={() => {
              setModalError(null);
              setRequestModalOpen(true);
            }}
          >
            Request case access
          </button>
        ) : null}
      </div>
      <div className="flex gap-2" role="tablist">
        {can(permissions, "ACCESS_REQUEST.READ") ? (
          <button
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm ${scope === "mine" ? "border-navy bg-navy text-white" : "border-line bg-white"}`}
            onClick={() => setScope("mine")}
          >
            My requests
          </button>
        ) : null}
        {can(permissions, "ACCESS_REQUEST.APPROVE") ? (
          <>
            <button
              type="button"
              className={`rounded-md border px-3 py-1.5 text-sm ${scope === "pending" ? "border-navy bg-navy text-white" : "border-line bg-white"}`}
              onClick={() => setScope("pending")}
            >
              Pending approvals
            </button>
            <button
              type="button"
              className={`rounded-md border px-3 py-1.5 text-sm ${scope === "active" ? "border-navy bg-navy text-white" : "border-line bg-white"}`}
              onClick={() => setScope("active")}
            >
              Active grants
            </button>
          </>
        ) : null}
      </div>
      {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <section className="rounded-lg border border-line bg-white">
        {items === null && !error ? <p className="px-5 py-4 text-sm text-muted">Loading requests…</p> : null}
        {items && items.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No {scope} requests</p> : null}
        {items && items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Case</th>
                  <th className="px-5 py-3 font-medium">Requester</th>
                  <th className="px-5 py-3 font-medium">Request</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">{scope === "active" ? "Expires" : "Created"}</th>
                  {scope === "pending" || scope === "active" ? (
                    <th className="px-5 py-3 font-medium">Action</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-medium">{item.case_number}</td>
                    <td className="px-5 py-3">{item.requester_username}</td>
                    <td className="px-5 py-3">
                      {item.resource_type} {item.requested_action}
                      {item.access_kind === "EMERGENCY" ? (
                        <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          Emergency (24h)
                        </span>
                      ) : null}
                      <span className="mt-1 block text-xs text-muted">{item.justification}</span>
                    </td>
                    <td className="px-5 py-3">{item.status}</td>
                    <td className="px-5 py-3 text-muted">
                      {scope === "active"
                        ? item.expires_at
                          ? formatTimestamp(item.expires_at)
                          : "No expiry"
                        : formatTimestamp(item.created_at)}
                    </td>
                    {scope === "pending" ? (
                      <td className="px-5 py-3">
                        {item.requester_id === session.id ? (
                          <span className="text-xs text-muted">Own request</span>
                        ) : (
                          <div className="flex gap-3">
                            <button
                              type="button"
                              className="text-sm font-medium text-navy underline-offset-4 hover:underline"
                              onClick={() =>
                                setConfirm({
                                  title: "Approve access request?",
                                  message: `Approve ${item.requested_action} on ${item.resource_type} for ${item.requester_username}.`,
                                  confirmLabel: "Approve",
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
                              Approve
                            </button>
                            <button
                              type="button"
                              className="text-sm text-danger underline-offset-4 hover:underline"
                              onClick={() =>
                                setConfirm({
                                  title: "Reject access request?",
                                  message: `Reject the request from ${item.requester_username}.`,
                                  confirmLabel: "Reject",
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
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    ) : null}
                    {scope === "active" ? (
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          className="text-sm text-danger underline-offset-4 hover:underline"
                          onClick={() =>
                            setConfirm({
                              title: "Revoke access grant?",
                              message: `Immediately revoke access for ${item.requester_username} on ${item.case_number}.`,
                              confirmLabel: "Revoke Access",
                              run: async () => {
                                await apiFetch(`/api/access-requests/${item.id}/revoke`, {
                                  method: "POST",
                                  body: JSON.stringify({ note: "Access grant revoked early by supervisor." }),
                                });
                                setItems((current) => (current ?? []).filter((row) => row.id !== item.id));
                                setNotice("Access grant revoked.");
                              },
                            })
                          }
                        >
                          Revoke
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {requestModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-line bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-navy">Request Case Access</h3>
            <p className="mt-1 text-sm text-muted">
              Submit an access request to the owning police department for case examination or trial proceedings.
            </p>
            {modalError ? (
              <p role="alert" className="mt-3 rounded-md bg-danger-bg p-2 text-sm text-danger">
                {modalError}
              </p>
            ) : null}
            <form onSubmit={handleCreateCaseRequest} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-navy">
                  Case Number
                  <input
                    required
                    type="text"
                    placeholder="e.g. CASE-2026-001"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                  />
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-navy">
                  Justification
                  <textarea
                    required
                    minLength={10}
                    rows={3}
                    placeholder="Provide official operational or legal reason for accessing this case..."
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={emergency}
                  onChange={(e) => setEmergency(e.target.checked)}
                  className="rounded border-line"
                />
                <span>Urgent / Emergency Access (24-hour temporary grant)</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-md border border-line px-4 py-2 text-sm"
                  onClick={() => setRequestModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-navy px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {busy ? "Submitting…" : "Submit Request"}
                </button>
              </div>
            </form>
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

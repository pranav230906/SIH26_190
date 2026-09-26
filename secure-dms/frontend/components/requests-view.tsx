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
  const [scope, setScope] = useState<"mine" | "pending">(can(permissions, "ACCESS_REQUEST.APPROVE") ? "pending" : "mine");
  const [items, setItems] = useState<AccessRequestRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; confirmLabel: string; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);

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
      setNotice(caught instanceof ApiClientError ? caught.message : "The review could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Access requests</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          Approval is decided by the service. A person cannot approve their own request.
        </p>
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
          <button
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm ${scope === "pending" ? "border-navy bg-navy text-white" : "border-line bg-white"}`}
            onClick={() => setScope("pending")}
          >
            Pending approvals
          </button>
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
        {items && items.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No pending requests</p> : null}
        {items && items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Case</th>
                  <th className="px-5 py-3 font-medium">Requester</th>
                  <th className="px-5 py-3 font-medium">Request</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  {scope === "pending" ? <th className="px-5 py-3 font-medium">Review</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-medium">{item.case_number}</td>
                    <td className="px-5 py-3">{item.requester_username}</td>
                    <td className="px-5 py-3">
                      {item.resource_type} {item.requested_action}
                      <span className="mt-1 block text-xs text-muted">{item.justification}</span>
                    </td>
                    <td className="px-5 py-3">{item.status}</td>
                    <td className="px-5 py-3 text-muted">{formatTimestamp(item.created_at)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { caseErrorMessage } from "@/lib/errors";
import { assignmentLabel, caseTypeLabel, formatDay, formatTimestamp, roleLabel, statusLabel } from "@/lib/format";
import type { AccessRequestRecord, AssignmentRecord, CaseDetail, DirectoryUser } from "@/lib/types";
import { can, usePermissions, useSession } from "@/components/session-context";
import { CaseModules } from "@/components/case-modules";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingBlock } from "@/components/loading-block";
import { StatusBadge } from "@/components/status-badge";
import { AuditTimeline } from "@/components/audit-timeline";

const ASSIGNMENT_TYPES = [
  "PRIMARY_OFFICER",
  "SUPERVISOR",
  "FORENSIC_EXAMINER",
  "FORENSIC_REVIEWER",
  "PROSECUTOR",
  "JUDICIAL_ACCESS",
];

export function CaseDetailView() {
  const params = useParams<{ id: string }>();
  const session = useSession();
  const { permissions } = usePermissions();
  const [record, setRecord] = useState<CaseDetail | null>(null);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [requests, setRequests] = useState<AccessRequestRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [assignmentType, setAssignmentType] = useState("PRIMARY_OFFICER");
  const [justification, setJustification] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [resourceType, setResourceType] = useState("EVIDENCE");
  const [requestedAction, setRequestedAction] = useState("READ");
  const [confirm, setConfirm] = useState<null | { title: string; message: string; confirmLabel: string; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CaseDetail>(`/api/cases/${params.id}`)
      .then((data) => {
        if (!cancelled) {
          setRecord(data);
          setTitle(data.title);
          setDescription(data.description);
          setNextStatus("");
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caseErrorMessage(caught, "This case could not be opened."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    if (!record) {
      return;
    }
    let cancelled = false;
    if (can(permissions, "ACCESS_REQUEST.READ")) {
      apiFetch<{ items: AccessRequestRecord[] }>(`/api/cases/${record.id}/access-requests`)
        .then((data) => {
          if (!cancelled) {
            setRequests(data.items);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setNotice(caseErrorMessage(caught, "Access requests could not be loaded."));
            setRequests([]);
          }
        });
    }
    if (can(permissions, "CASE.ASSIGN")) {
      apiFetch<{ items: DirectoryUser[] }>("/api/users/directory")
        .then((data) => {
          if (!cancelled) {
            setDirectory(data.items.filter((item) => item.id !== session.id));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDirectory([]);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [permissions, record, session.id]);

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
      setNotice(caseErrorMessage(caught, "The action could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  async function refreshCase() {
    const data = await apiFetch<CaseDetail>(`/api/cases/${params.id}`);
    setRecord(data);
    setTitle(data.title);
    setDescription(data.description);
    setNextStatus("");
  }

  const timelineGroups = groupTimeline(record?.timeline ?? []);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/dashboard" className="hover:underline">Dashboard</Link>
        <span className="px-2">/</span>
        <Link href="/cases" className="hover:underline">Cases</Link>
        <span className="px-2">/</span>
        <span className="text-ink">{record?.case_number ?? "Case"}</span>
      </nav>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      {!record && !error ? <LoadingBlock label="Loading case…" lines={4} /> : null}

      {record ? (
        <>
          <header className="rounded-lg border border-line bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-sm text-muted">{record.case_number}</p>
                <h2 className="mt-1 text-2xl font-semibold">{record.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge status={record.status} />
                  <span className="text-sm text-muted">{record.department?.name ?? "Department not recorded"}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {can(permissions, "CASE.UPDATE") ? (
                  <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => setEditing((current) => !current)}>
                    Edit case
                  </button>
                ) : null}
                {can(permissions, "CASE.ASSIGN") ? (
                  <a href="#assignments" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
                    Manage assignments
                  </a>
                ) : null}
              </div>
            </div>
          </header>

          {editing && can(permissions, "CASE.UPDATE") ? (
            <form
              className="grid gap-3 rounded-lg border border-line bg-white p-5"
              onSubmit={(event) => {
                event.preventDefault();
                const changingStatus = nextStatus !== "" && nextStatus !== record.status;
                setConfirm({
                  title: changingStatus ? "Change the case status?" : "Save case details?",
                  message: changingStatus
                    ? `Status will move from ${statusLabel(record.status)} to ${statusLabel(nextStatus)}.`
                    : "The title and description will be updated. The case number stays the same.",
                  confirmLabel: changingStatus ? "Change status" : "Save",
                  run: async () => {
                    const body: Record<string, string> = { title, description };
                    if (changingStatus) {
                      body.status = nextStatus;
                    }
                    const updated = await apiFetch<CaseDetail>(`/api/cases/${record.id}`, {
                      method: "PATCH",
                      body: JSON.stringify(body),
                    });
                    setRecord(updated);
                    setTitle(updated.title);
                    setDescription(updated.description);
                    setNextStatus("");
                    setEditing(false);
                    setNotice("Case details saved.");
                  },
                });
              }}
            >
              <label className="text-sm">
                <span className="mb-1 block text-muted">Title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} className="w-full rounded-md border border-line px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Description</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} required className="min-h-24 w-full rounded-md border border-line px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Status</span>
                <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="w-full rounded-md border border-line bg-white px-3 py-2">
                  <option value="">Keep {statusLabel(record.status)}</option>
                  {record.allowed_status_transitions.map((item) => (
                    <option key={item} value={item}>
                      {statusLabel(item)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">
                Save case
              </button>
            </form>
          ) : null}

          <section className="rounded-lg border border-line bg-white p-6">
            <h3 className="text-base font-semibold">Overview</h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs tracking-[0.14em] text-muted uppercase">Case type</dt>
                <dd className="mt-1 text-sm">{caseTypeLabel(record.case_type)}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-[0.14em] text-muted uppercase">Current status</dt>
                <dd className="mt-1 text-sm">{statusLabel(record.status)}</dd>
              </div>
              <div>
                <dt className="text-xs tracking-[0.14em] text-muted uppercase">Created</dt>
                <dd className="mt-1 text-sm">
                  {formatTimestamp(record.created_at)}
                  <span className="block text-muted">by {record.created_by_name}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-[0.14em] text-muted uppercase">Last updated</dt>
                <dd className="mt-1 text-sm">{formatTimestamp(record.updated_at)}</dd>
              </div>
            </dl>
            <h4 className="mt-6 text-sm font-semibold">Description</h4>
            <p className="mt-2 max-w-3xl text-sm leading-6">{record.description}</p>
          </section>

          <section id="assignments" className="rounded-lg border border-line bg-white">
            <div className="border-b border-line px-5 py-4">
              <h3 className="text-base font-semibold">Participants</h3>
            </div>
            {record.participants.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">No participants are assigned.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Role</th>
                      <th className="px-5 py-3 font-medium">Department</th>
                      <th className="px-5 py-3 font-medium">Assignment type</th>
                      <th className="px-5 py-3 font-medium">Assignment date</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      {can(permissions, "CASE.ASSIGN") ? <th className="px-5 py-3 font-medium">Action</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {record.participants.map((item) => (
                      <tr key={item.assignment_id} className="border-b border-line last:border-0">
                        <td className="px-5 py-3">
                          {item.full_name}
                          <span className="block text-xs text-muted">{item.username}</span>
                        </td>
                        <td className="px-5 py-3">{roleLabel(item.role_name)}</td>
                        <td className="px-5 py-3">{item.department_name}</td>
                        <td className="px-5 py-3">{assignmentLabel(item.assignment_type)}</td>
                        <td className="px-5 py-3 text-muted">{formatDay(item.assigned_at)}</td>
                        <td className="px-5 py-3">{item.active ? "Active" : "Inactive"}</td>
                        {can(permissions, "CASE.ASSIGN") ? (
                          <td className="px-5 py-3">
                            {item.user_id === session.id ? (
                              <span className="text-xs text-muted">Your assignment</span>
                            ) : (
                              <button
                                type="button"
                                className="text-sm text-danger underline-offset-4 hover:underline"
                                onClick={() =>
                                  setConfirm({
                                    title: "Remove this assignment?",
                                    message: `${item.full_name} will lose this assignment on ${record.case_number}.`,
                                    confirmLabel: "Remove assignment",
                                    run: async () => {
                                      await apiFetch(`/api/cases/${record.id}/assignments/${item.assignment_id}`, { method: "DELETE" });
                                      await refreshCase();
                                      setNotice("Assignment removed.");
                                    },
                                  })
                                }
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {can(permissions, "CASE.ASSIGN") ? (
              <form
                className="grid gap-3 border-t border-line p-5 md:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const person = directory.find((item) => item.id === targetUser);
                  setConfirm({
                    title: "Assign user to case?",
                    message: `${person?.full_name ?? "This user"} will be assigned to ${record.case_number} as ${assignmentLabel(assignmentType)}.`,
                    confirmLabel: "Assign user",
                    run: async () => {
                      await apiFetch<AssignmentRecord>(`/api/cases/${record.id}/assignments`, {
                        method: "POST",
                        body: JSON.stringify({ user_id: targetUser, assignment_type: assignmentType }),
                      });
                      await refreshCase();
                      setNotice("Assignment saved.");
                    },
                  });
                }}
              >
                <label className="text-sm">
                  <span className="mb-1 block text-muted">User</span>
                  <select required value={targetUser} onChange={(event) => setTargetUser(event.target.value)} className="w-full rounded-md border border-line px-3 py-2">
                    <option value="">Select a user</option>
                    {directory.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.full_name} ({item.username})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-muted">Assignment type</span>
                  <select value={assignmentType} onChange={(event) => setAssignmentType(event.target.value)} className="w-full rounded-md border border-line px-3 py-2">
                    {ASSIGNMENT_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {assignmentLabel(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
                    Assign
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          <CaseModules caseId={record.id} />

          <section id="requests" className="space-y-4">
            <h3 className="text-base font-semibold">Requests</h3>
            {!can(permissions, "ACCESS_REQUEST.READ") ? (
              <p className="text-sm text-muted">Access requests are not available for this role.</p>
            ) : requests === null ? (
              <LoadingBlock label="Loading requests…" lines={2} />
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted">No access requests.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line bg-white">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th className="px-5 py-3 font-medium">Requester</th>
                      <th className="px-5 py-3 font-medium">Request</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Justification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((item) => (
                      <tr key={item.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-3">{item.requester_username}</td>
                        <td className="px-5 py-3">{item.resource_type} {item.requested_action}{item.access_kind === "EMERGENCY" ? " · 24h" : ""}</td>
                        <td className="px-5 py-3">{item.status}</td>
                        <td className="px-5 py-3">{item.justification}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {can(permissions, "ACCESS_REQUEST.CREATE") ? (
              <form
                className="grid gap-3 rounded-lg border border-line bg-white p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setConfirm({
                    title: "Submit this access request?",
                    message: `Request ${requestedAction} on ${resourceType} for ${record.case_number}.`,
                    confirmLabel: "Submit request",
                    run: async () => {
                      const created = await apiFetch<AccessRequestRecord>(`/api/cases/${record.id}/access-requests`, {
                        method: "POST",
                        body: JSON.stringify({
                          resource_type: resourceType,
                          requested_action: requestedAction,
                          justification,
                          emergency,
                        }),
                      });
                      setRequests((current) => [created, ...(current ?? [])]);
                      setJustification("");
                      setEmergency(false);
                      setNotice("Access request submitted.");
                    },
                  });
                }}
              >
                <h4 className="text-sm font-semibold">Request access</h4>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-muted">Resource</span>
                    <select value={resourceType} onChange={(event) => setResourceType(event.target.value)} className="w-full rounded-md border border-line px-3 py-2">
                      <option value="DOCUMENT">Document</option>
                      <option value="EVIDENCE">Evidence</option>
                      <option value="FORENSIC_REPORT">Forensic report</option>
                      <option value="COURT_PACKAGE">Court package</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-muted">Action</span>
                    <select value={requestedAction} onChange={(event) => setRequestedAction(event.target.value)} className="w-full rounded-md border border-line px-3 py-2">
                      <option value="READ">Read</option>
                      <option value="DOWNLOAD">Download</option>
                      <option value="UPLOAD">Upload</option>
                      <option value="EXPORT">Export</option>
                      <option value="VERIFY">Verify</option>
                    </select>
                  </label>
                </div>
                <label className="text-sm">
                  <span className="mb-1 block text-muted">Justification</span>
                  <textarea required minLength={10} value={justification} onChange={(event) => setJustification(event.target.value)} className="min-h-24 w-full rounded-md border border-line px-3 py-2" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={emergency} onChange={(event) => setEmergency(event.target.checked)} />
                  Emergency access, 24 hours, reason required
                </label>
                <button type="submit" className="w-fit rounded-md bg-navy px-3 py-2 text-sm text-white">
                  Submit request
                </button>
              </form>
            ) : null}
          </section>

          <AuditTimeline title="Case activity" caseId={record.id} />

          <section className="rounded-lg border border-line bg-white p-6">
            <h3 className="text-base font-semibold">Case timeline</h3>
            {timelineGroups.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No timeline events are recorded.</p>
            ) : (
              <ol className="mt-4 space-y-5">
                {timelineGroups.map((group) => (
                  <li key={group.day}>
                    <p className="text-sm font-medium">{group.day}</p>
                    <ul className="mt-2 space-y-2 border-l border-line pl-4">
                      {group.events.map((event) => (
                        <li key={event.id} className="text-sm">
                          {event.message}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
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

function groupTimeline(events: CaseDetail["timeline"]) {
  const groups: { day: string; events: CaseDetail["timeline"] }[] = [];
  for (const event of events) {
    const day = formatDay(event.occurred_at);
    const current = groups[groups.length - 1];
    if (!current || current.day !== day) {
      groups.push({ day, events: [event] });
    } else {
      current.events.push(event);
    }
  }
  return groups;
}

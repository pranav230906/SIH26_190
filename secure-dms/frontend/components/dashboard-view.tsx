"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { caseErrorMessage } from "@/lib/errors";
import { formatDay, roleLabel } from "@/lib/format";
import type { AccessRequestRecord, CaseListResponse, CaseSummary, DepartmentRecord, UserRecord } from "@/lib/types";
import { can, usePermissions, useSession } from "@/components/session-context";
import { CaseCard } from "@/components/case-card";
import { LoadingBlock } from "@/components/loading-block";

type Panel = {
  title: string;
  empty: string;
  kind: "cases" | "status" | "activity" | "requests" | "note" | "metrics";
  status?: string;
  requestFilter?: "mine" | "pending" | "evidence";
};

const PANELS: Record<string, Panel[]> = {
  POLICE_OFFICER: [
    { title: "My cases", kind: "cases", empty: "No cases have been assigned to you." },
    { title: "Active investigations", kind: "status", status: "UNDER_INVESTIGATION", empty: "No active investigations." },
    { title: "Recent case activity", kind: "activity", empty: "No recent case activity." },
    { title: "Pending access requests", kind: "requests", requestFilter: "mine", empty: "No pending requests." },
  ],
  POLICE_SUPERVISOR: [
    { title: "Supervised cases", kind: "cases", empty: "No cases have been assigned to you." },
    { title: "Cases under review", kind: "status", status: "UNDER_REVIEW", empty: "No cases are currently under review." },
    { title: "Pending approvals", kind: "requests", requestFilter: "pending", empty: "No pending approvals." },
    { title: "Recent case activity", kind: "activity", empty: "No recent case activity." },
  ],
  FORENSIC_EXAMINER: [
    { title: "Assigned cases", kind: "cases", empty: "No forensic assignments yet." },
    { title: "Forensic work queue", kind: "note", empty: "Forensic work records are not available in this stage." },
    { title: "Evidence access requests", kind: "requests", requestFilter: "evidence", empty: "No pending requests." },
    { title: "Recent case activity", kind: "activity", empty: "No recent case activity." },
  ],
  FORENSIC_REVIEWER: [
    { title: "Assigned cases", kind: "cases", empty: "No cases have been assigned to you." },
    { title: "Pending forensic reviews", kind: "note", empty: "No pending reviews." },
    { title: "Recent activity", kind: "activity", empty: "No recent case activity." },
  ],
  PROSECUTOR: [
    { title: "Assigned cases", kind: "cases", empty: "No cases have been assigned to you." },
    { title: "Cases ready for prosecution", kind: "status", status: "READY_FOR_PROSECUTION", empty: "No cases are ready for prosecution." },
    { title: "Recent case activity", kind: "activity", empty: "No recent case activity." },
  ],
  JUDICIAL_USER: [
    { title: "Authorized cases", kind: "cases", empty: "No cases have been assigned to you." },
    { title: "Cases in court", kind: "status", status: "IN_COURT", empty: "No cases are currently in court." },
    { title: "Recent court activity", kind: "activity", status: "IN_COURT", empty: "No recent court activity." },
  ],
  ADMIN: [
    { title: "System records", kind: "metrics", empty: "No active cases" },
    { title: "Cases", kind: "cases", empty: "No cases are recorded." },
  ],
};

export function DashboardView() {
  const session = useSession();
  const { permissions } = usePermissions();
  const panels = PANELS[session.role.name] ?? PANELS.POLICE_OFFICER;
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [totalCases, setTotalCases] = useState(0);
  const [requests, setRequests] = useState<AccessRequestRecord[] | null>(null);
  const [pending, setPending] = useState<AccessRequestRecord[] | null>(null);
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [departments, setDepartments] = useState<DepartmentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const jobs: Promise<void>[] = [];
    if (can(permissions, "CASE.READ")) {
      jobs.push(
        apiFetch<CaseListResponse>("/api/cases?page_size=100").then((data) => {
          if (!cancelled) {
            setCases(data.items);
            setTotalCases(data.total);
          }
        }),
      );
    } else if (!cancelled) {
      setCases([]);
    }
    if (can(permissions, "ACCESS_REQUEST.READ")) {
      jobs.push(
        apiFetch<{ items: AccessRequestRecord[] }>("/api/access-requests?scope=mine").then((data) => {
          if (!cancelled) {
            setRequests(data.items);
          }
        }),
      );
    }
    if (can(permissions, "ACCESS_REQUEST.APPROVE")) {
      jobs.push(
        apiFetch<{ items: AccessRequestRecord[] }>("/api/access-requests?scope=pending").then((data) => {
          if (!cancelled) {
            setPending(data.items);
          }
        }),
      );
    }
    if (can(permissions, "USER.READ")) {
      jobs.push(
        apiFetch<{ items: UserRecord[] }>("/api/users").then((data) => {
          if (!cancelled) {
            setUsers(data.items);
          }
        }),
      );
    }
    if (can(permissions, "DEPARTMENT.READ")) {
      jobs.push(
        apiFetch<{ items: DepartmentRecord[] }>("/api/departments").then((data) => {
          if (!cancelled) {
            setDepartments(data.items);
          }
        }),
      );
    }
    Promise.all(jobs).catch((caught: unknown) => {
      if (!cancelled) {
        setError(caseErrorMessage(caught, "The dashboard could not be loaded."));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [permissions]);

  const inProgress = (cases ?? []).filter((item) => item.status !== "CLOSED" && item.status !== "ARCHIVED").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Good morning, {session.full_name.split(' ')[0]}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Case activity and actions requiring your attention
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {can(permissions, "CASE.READ") ? (
            <Link href="/cases" className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm">
              View Cases
            </Link>
          ) : null}
          {can(permissions, "ACCESS_REQUEST.APPROVE") || can(permissions, "ACCESS_REQUEST.READ") ? (
            <Link href="/requests" className="rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              Review Requests
            </Link>
          ) : null}
          {can(permissions, "USER.READ") ? (
            <Link href="/users" className="rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              Users
            </Link>
          ) : null}
          {can(permissions, "DEPARTMENT.READ") ? (
            <Link href="/departments" className="rounded-md border border-slate-200 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              Departments
            </Link>
          ) : null}
        </div>
      </div>
      
      {/* Metrics Row (for standard roles, we summarize from loaded data) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Active Cases</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{cases === null ? "-" : inProgress}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Pending Requests</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{requests === null ? "-" : requests.filter(r => r.status === "PENDING").length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Pending Approvals</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{pending === null ? "-" : pending.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Total Cases</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{cases === null ? "-" : totalCases}</p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {panels.map((panel) => (
          <section key={panel.title} className="rounded-lg border border-line bg-white">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold">{panel.title}</h2>
            </div>
            <PanelBody
              panel={panel}
              cases={cases}
              totalCases={totalCases}
              inProgress={inProgress}
              requests={requests}
              pending={pending}
              users={users}
              departments={departments}
            />
          </section>
        ))}
      </div>
      {session.role.name === "FORENSIC_EXAMINER" ? (
        <p className="text-sm text-muted">View evidence is not available in this stage.</p>
      ) : null}
    </div>
  );
}

function PanelBody({
  panel,
  cases,
  totalCases,
  inProgress,
  requests,
  pending,
  users,
  departments,
}: {
  panel: Panel;
  cases: CaseSummary[] | null;
  totalCases: number;
  inProgress: number;
  requests: AccessRequestRecord[] | null;
  pending: AccessRequestRecord[] | null;
  users: UserRecord[] | null;
  departments: DepartmentRecord[] | null;
}) {
  if (panel.kind === "note") {
    return <p className="px-5 py-4 text-sm text-muted">{panel.empty}</p>;
  }
  if (panel.kind === "metrics") {
    if (cases === null || users === null || departments === null) {
      return <LoadingBlock label="Loading records…" />;
    }
    const metrics = [
      { label: "Total users", value: String(users.length) },
      { label: "Total cases", value: String(totalCases) },
      { label: "Cases in progress", value: inProgress === 0 ? "No active cases" : String(inProgress) },
      { label: "Departments", value: String(departments.length) },
    ];
    return (
      <ul className="grid gap-3 p-5 sm:grid-cols-2">
        {metrics.map((item) => (
          <li key={item.label} className="rounded-md border border-line px-4 py-3">
            <p className="text-xs tracking-[0.14em] text-muted uppercase">{item.label}</p>
            <p className="mt-2 text-lg font-semibold">{item.value}</p>
          </li>
        ))}
      </ul>
    );
  }
  if (panel.kind === "cases" || panel.kind === "status") {
    if (cases === null) {
      return <LoadingBlock label="Loading cases…" />;
    }
    const rows = panel.kind === "status" ? cases.filter((item) => item.status === panel.status) : cases;
    if (rows.length === 0) {
      return <p className="px-5 py-4 text-sm text-muted">{panel.empty}</p>;
    }
    return (
      <div className="grid sm:grid-cols-2 gap-4 p-5">
        {rows.map((item) => (
          <CaseCard key={item.id} item={item} />
        ))}
      </div>
    );
  }
  if (panel.kind === "activity") {
    if (cases === null) {
      return <LoadingBlock label="Loading activity…" lines={2} />;
    }
    const source = panel.status ? cases.filter((item) => item.status === panel.status) : cases;
    const rows = [...source].sort((left, right) => right.updated_at.localeCompare(left.updated_at)).slice(0, 5);
    if (rows.length === 0) {
      return <p className="px-5 py-4 text-sm text-muted">{panel.empty}</p>;
    }
    return (
      <ul className="divide-y divide-line">
        {rows.map((item) => (
          <li key={item.id}>
            <Link href={`/cases/${item.id}`} className="block px-5 py-3 hover:bg-paper">
              <span className="font-medium">{item.case_number}</span>
              <span className="mt-1 block text-sm">{item.title}</span>
              <span className="mt-1 block text-xs text-muted">Updated {formatDay(item.updated_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  const source = panel.requestFilter === "pending" ? pending : requests;
  if (source === null) {
    return <LoadingBlock label="Loading requests…" lines={2} />;
  }
  const rows =
    panel.requestFilter === "evidence"
      ? source.filter((item) => item.resource_type === "EVIDENCE" && item.status === "PENDING")
      : panel.requestFilter === "mine"
        ? source.filter((item) => item.status === "PENDING")
        : source;
  if (rows.length === 0) {
    return <p className="px-5 py-4 text-sm text-muted">{panel.empty}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {rows.map((item) => (
        <li key={item.id} className="px-5 py-3 text-sm">
          <p className="font-medium">
            {item.case_number} · {item.resource_type} {item.requested_action}
          </p>
          <p className="mt-1 text-muted">
            {item.requester_username} · {item.status}
          </p>
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { caseErrorMessage } from "@/lib/errors";
import { statusLabel } from "@/lib/format";
import type { CaseDetail, CaseDepartment, CaseListResponse, DepartmentRecord } from "@/lib/types";
import { can, usePermissions } from "@/components/session-context";
import { CaseCard } from "@/components/case-card";
import { CaseTable } from "@/components/case-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingBlock } from "@/components/loading-block";

const STATUSES = [
  "DRAFT",
  "ACTIVE",
  "UNDER_INVESTIGATION",
  "UNDER_REVIEW",
  "READY_FOR_PROSECUTION",
  "IN_COURT",
  "CLOSED",
  "ARCHIVED",
];

export function CasesView() {
  const { permissions } = usePermissions();
  const [data, setData] = useState<CaseListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<CaseDepartment[]>([]);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState({
    case_number: "",
    title: "",
    description: "",
    case_type: "CRIMINAL",
    status: "DRAFT",
    classification: "RESTRICTED",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reqCaseNumber, setReqCaseNumber] = useState("");
  const [reqJustification, setReqJustification] = useState("");
  const [reqEmergency, setReqEmergency] = useState(false);
  const [reqModalError, setReqModalError] = useState<string | null>(null);

  useEffect(() => {
    if (!can(permissions, "DEPARTMENT.READ")) {
      return;
    }
    let cancelled = false;
    apiFetch<{ items: DepartmentRecord[] }>("/api/departments")
      .then((result) => {
        if (!cancelled) {
          setDepartments(result.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDepartments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [permissions]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), page_size: "8" });
    if (status) {
      params.set("status", status);
    }
    if (departmentId) {
      params.set("department_id", departmentId);
    }
    if (appliedQuery.trim()) {
      params.set("q", appliedQuery.trim());
    }
    apiFetch<CaseListResponse>(`/api/cases?${params.toString()}`)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
          if (!can(permissions, "DEPARTMENT.READ")) {
            setDepartments((current) => mergeDepartments(current, result.items));
          }
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caseErrorMessage(caught, "Cases could not be loaded."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appliedQuery, departmentId, page, permissions, reloadKey, status]);

  async function createCase() {
    setBusy(true);
    setNotice(null);
    try {
      const created = await apiFetch<CaseDetail>("/api/cases", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setConfirmOpen(false);
      setDraft({
        case_number: "",
        title: "",
        description: "",
        case_type: "CRIMINAL",
        status: "DRAFT",
        classification: "RESTRICTED",
      });
      setPage(1);
      setNotice(`${created.case_number} was created.`);
      setReloadKey((current) => current + 1);
      setAppliedQuery("");
      setQuery("");
      setStatus("");
    } catch (caught: unknown) {
      setConfirmOpen(false);
      setNotice(caseErrorMessage(caught, "The case could not be created."));
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];
  const from = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0;
  const to = data ? Math.min(data.page * data.page_size, data.total) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">Case Register</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Search covers case number and title. The service returns only cases this account can open.
          </p>
        </div>
        {can(permissions, "ACCESS_REQUEST.CREATE") ? (
          <button
            type="button"
            className="rounded-md bg-blue-600 hover:bg-blue-700 transition-colors px-4 py-2 text-sm font-medium text-white shadow-sm"
            onClick={() => {
              setReqModalError(null);
              setRequestModalOpen(true);
            }}
          >
            Request Case Access
          </button>
        ) : null}
      </div>

      <form
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setAppliedQuery(query);
        }}
      >
        <label className="text-sm md:col-span-2">
          <span className="mb-1.5 block font-medium text-slate-700">Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Case number or title..."
          />
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {statusLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Department</span>
          <select
            value={departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All visible departments</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-4 flex justify-end mt-2">
          <button type="submit" className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 transition-colors px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
            Apply Filters
          </button>
        </div>
      </form>

      {can(permissions, "CASE.CREATE") ? (
        <form
          className="grid gap-3 rounded-lg border border-line bg-white p-5 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setConfirmOpen(true);
          }}
        >
          <h2 className="text-base font-semibold md:col-span-2">Create case</h2>
          <label className="text-sm">
            <span className="mb-1 block text-muted">Case number</span>
            <input
              required
              value={draft.case_number}
              onChange={(event) => setDraft({ ...draft, case_number: event.target.value })}
              className="w-full rounded-md border border-line px-3 py-2"
              placeholder="CASE-2026-010"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">Title</span>
            <input
              required
              minLength={3}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              className="w-full rounded-md border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-muted">Description</span>
            <textarea
              required
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className="min-h-24 w-full rounded-md border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">Type</span>
            <select
              value={draft.case_type}
              onChange={(event) => setDraft({ ...draft, case_type: event.target.value })}
              className="w-full rounded-md border border-line px-3 py-2"
            >
              <option value="CRIMINAL">Criminal</option>
              <option value="CIVIL">Civil</option>
              <option value="FORENSIC">Forensic</option>
              <option value="ADMINISTRATIVE">Administrative</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">Initial status</span>
            <select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              className="w-full rounded-md border border-line px-3 py-2"
            >
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
              Create case
            </button>
          </div>
        </form>
      ) : null}

      {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-line bg-white">
        {data === null && !error ? <LoadingBlock label="Loading cases…" /> : null}
        {data && items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">
            {appliedQuery || status || departmentId
              ? "No cases match this search."
              : "No cases are visible to this account."}
          </p>
        ) : null}
        {items.length > 0 ? (
          <>
            <div className="hidden md:block">
              <CaseTable items={items} />
            </div>
            <div className="grid gap-3 p-4 md:hidden">
              {items.map((item) => (
                <CaseCard key={item.id} item={item} />
              ))}
            </div>
            {data ? (
              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
                <p className="text-muted">
                  Showing {from}–{to} of {data.total}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-line px-3 py-1.5 disabled:opacity-50"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-line px-3 py-1.5 disabled:opacity-50"
                    disabled={data.page * data.page_size >= data.total}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {requestModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-line bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-navy">Request Case Access</h3>
            <p className="mt-1 text-sm text-muted">
              Submit an access request to the owning police department for case examination or trial proceedings.
            </p>
            {reqModalError ? (
              <p role="alert" className="mt-3 rounded-md bg-danger-bg p-2 text-sm text-danger">
                {reqModalError}
              </p>
            ) : null}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setReqModalError(null);
                setBusy(true);
                try {
                  await apiFetch("/api/access-requests/case", {
                    method: "POST",
                    body: JSON.stringify({
                      case_number: reqCaseNumber.trim(),
                      justification: reqJustification.trim(),
                      emergency: reqEmergency,
                    }),
                  });
                  setRequestModalOpen(false);
                  setReqCaseNumber("");
                  setReqJustification("");
                  setReqEmergency(false);
                  setNotice("Case access request submitted. Awaiting supervisor review.");
                } catch (caught) {
                  setReqModalError(caseErrorMessage(caught, "Request could not be submitted."));
                } finally {
                  setBusy(false);
                }
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-navy">
                  Case Number
                  <input
                    required
                    type="text"
                    placeholder="e.g. CASE-2026-001"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                    value={reqCaseNumber}
                    onChange={(e) => setReqCaseNumber(e.target.value)}
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
                    value={reqJustification}
                    onChange={(e) => setReqJustification(e.target.value)}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reqEmergency}
                  onChange={(e) => setReqEmergency(e.target.checked)}
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
        open={confirmOpen}
        title="Create this case?"
        message={`${draft.case_number || "This case"} will be recorded as ${draft.title || "the title entered"}.`}
        confirmLabel="Create case"
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={createCase}
      />
    </div>
  );
}

function mergeDepartments(current: CaseDepartment[], items: CaseListResponse["items"]): CaseDepartment[] {
  const next = new Map(current.map((item) => [item.id, item]));
  for (const item of items) {
    if (item.department) {
      next.set(item.department.id, item.department);
    }
  }
  return [...next.values()].sort((left, right) => left.name.localeCompare(right.name));
}

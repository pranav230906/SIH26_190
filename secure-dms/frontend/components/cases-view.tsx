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
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Case register</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          Search covers case number and title. The service returns only cases this account can open.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setAppliedQuery(query);
        }}
      >
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-muted">Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-md border border-line px-3 py-2"
            placeholder="Case number or title"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-line bg-white px-3 py-2"
          >
            <option value="">All statuses</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {statusLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Department</span>
          <select
            value={departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-line bg-white px-3 py-2"
          >
            <option value="">All visible departments</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-4">
          <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
            Search
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

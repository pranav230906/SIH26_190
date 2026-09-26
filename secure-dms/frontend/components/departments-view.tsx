"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { caseErrorMessage } from "@/lib/errors";
import type { DepartmentRecord } from "@/lib/types";
import { can, usePermissions } from "@/components/session-context";
import { LoadingBlock } from "@/components/loading-block";

export function DepartmentsView() {
  const { permissions } = usePermissions();
  const [items, setItems] = useState<DepartmentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!can(permissions, "DEPARTMENT.READ")) {
      setError("You are not authorized to perform this action.");
      setItems([]);
      return;
    }
    let cancelled = false;
    apiFetch<{ items: DepartmentRecord[] }>("/api/departments")
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caseErrorMessage(caught, "Departments could not be loaded."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [permissions]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Departments</h2>
        <p className="mt-1 text-sm text-muted">Departments recorded for this demonstration.</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <section className="rounded-lg border border-line bg-white">
        {items === null && !error ? <LoadingBlock label="Loading departments…" /> : null}
        {items && items.length === 0 && !error ? <p className="px-5 py-4 text-sm text-muted">No departments are recorded.</p> : null}
        {items && items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-left text-sm">
              <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Code</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">{item.name}</td>
                    <td className="px-5 py-3">{item.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

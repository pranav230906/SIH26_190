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
    <div className="space-y-8">
      <div className="bg-slate-900 rounded-xl p-8 shadow-md text-white border-b-4 border-blue-600 flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold uppercase tracking-wide flex items-center gap-3">
             <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
             Departments Registry
          </h2>
          <p className="mt-2 text-slate-400 font-medium">
            Authorized organizational units recorded within the jurisdiction.
          </p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-red-800 text-sm font-medium shadow-sm">
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> {error}
        </div>
      ) : null}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
           <h3 className="text-lg font-bold text-slate-900">Organizational Units</h3>
        </div>
        <div className="overflow-x-auto">
          {items === null && !error ? <div className="px-6 py-12 flex flex-col items-center justify-center text-slate-400"><svg className="animate-spin h-8 w-8 mb-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p className="font-medium text-sm">Loading units...</p></div> : null}
          {items && items.length === 0 && !error ? <p className="px-6 py-12 text-center text-slate-500">No organizational units are recorded.</p> : null}
          {items && items.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-slate-500">Unit Name</th>
                  <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-slate-500">Designation Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900">{item.name}</td>
                    <td className="px-6 py-4 font-mono text-slate-600 font-medium">{item.code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </div>
  );
}

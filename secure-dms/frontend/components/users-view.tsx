"use client";

import { useEffect, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api";
import { roleLabel } from "@/lib/format";
import type { DepartmentRecord, RoleListResponse, UserRecord } from "@/lib/types";
import { can, usePermissions, useSession } from "@/components/session-context";
import { ConfirmDialog } from "@/components/confirm-dialog";

const ROLES = [
  "ADMIN",
  "POLICE_OFFICER",
  "POLICE_SUPERVISOR",
  "FORENSIC_EXAMINER",
  "FORENSIC_REVIEWER",
  "PROSECUTOR",
  "JUDICIAL_USER",
];

export function UsersView() {
  const session = useSession();
  const { permissions } = usePermissions();
  const [users, setUsers] = useState<UserRecord[] | null>(null);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<null | { title: string; message: string; confirmLabel: string; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    username: "",
    full_name: "",
    email: "",
    password: "",
    role_name: "POLICE_OFFICER",
    department_id: "",
  });
  const [activeTab, setActiveTab] = useState<"users" | "roles">("users");
  const [rolesData, setRolesData] = useState<RoleListResponse | null>(null);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [permQuery, setPermQuery] = useState("");

  useEffect(() => {
    if (activeTab === "roles" && !rolesData && can(permissions, "ROLE.READ")) {
      setRolesLoading(true);
      apiFetch<RoleListResponse>("/api/roles")
        .then((res) => {
          setRolesData(res);
          setRolesLoading(false);
        })
        .catch((err) => {
          setError(err instanceof ApiClientError ? err.message : "Roles could not be loaded.");
          setRolesLoading(false);
        });
    }
  }, [activeTab, rolesData, permissions]);

  useEffect(() => {
    if (!can(permissions, "USER.READ")) {
      setError("You are not authorized to perform this action.");
      setUsers([]);
      return;
    }
    let cancelled = false;
    apiFetch<{ items: UserRecord[] }>("/api/users")
      .then((data) => {
        if (!cancelled) {
          setUsers(data.items);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiClientError ? caught.message : "Users could not be loaded.");
        }
      });
    if (can(permissions, "DEPARTMENT.READ")) {
      apiFetch<{ items: DepartmentRecord[] }>("/api/departments")
        .then((data) => {
          if (!cancelled) {
            setDepartments(data.items);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDepartments([]);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [permissions]);

  const visible = (users ?? []).filter((item) => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return (
      item.username.toLowerCase().includes(needle) ||
      item.full_name.toLowerCase().includes(needle) ||
      item.role.name.toLowerCase().includes(needle)
    );
  });

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
      setNotice(caught instanceof ApiClientError ? caught.message : "The account could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  const filteredPermissions = (rolesData?.all_permissions ?? []).filter((p) =>
    p.toLowerCase().includes(permQuery.trim().toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="bg-slate-900 rounded-xl p-8 shadow-md text-white border-b-4 border-blue-600 flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold uppercase tracking-wide flex items-center gap-3">
             <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
             Personnel Registry
          </h2>
          <p className="mt-2 text-slate-400 font-medium">
            Central administration for user clearance, institutional roles, and cross-departmental access matrix.
          </p>
        </div>
      </div>

      {notice ? <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-center gap-3 text-green-800 text-sm font-medium shadow-sm"><svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg> {notice}</div> : null}
      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-red-800 text-sm font-medium shadow-sm">
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> {error}
        </div>
      ) : null}

      <div className="flex gap-2 border-b-2 border-slate-200 text-sm font-bold uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={`pb-4 px-6 transition-colors border-b-4 ${
            activeTab === "users"
              ? "border-blue-600 text-blue-700 bg-blue-50/50"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
          }`}
        >
          Active Personnel
        </button>
        {can(permissions, "ROLE.READ") ? (
          <button
            type="button"
            onClick={() => setActiveTab("roles")}
            className={`pb-4 px-6 transition-colors border-b-4 ${
              activeTab === "roles"
                ? "border-blue-600 text-blue-700 bg-blue-50/50"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            }`}
          >
            Clearance Matrix
          </button>
        ) : null}
      </div>

      {activeTab === "roles" ? (
        <div className="space-y-8">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-blue-900 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              Institutional Separation of Duties
            </h3>
            <p className="mt-2 text-sm text-blue-800/80 leading-relaxed max-w-4xl">
              Role-Based Access Control (RBAC) enforces strict jurisdictional separation. System Administrators manage identities and system configuration, but have zero read or write access to criminal case content or evidence. Police, Forensics, Prosecution, and Judiciary operate within strictly segregated permissions.
            </p>
          </div>

          {rolesLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400"><svg className="animate-spin h-8 w-8 mb-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p className="font-bold uppercase tracking-widest text-sm">Loading matrix...</p></div>
          ) : rolesData ? (
            <div className="space-y-8">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {ROLES.map((roleName) => {
                  const role = rolesData.items.find((r) => r.name === roleName);
                  if (!role) return null;
                  return (
                    <div key={role.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                      <div className="absolute top-0 left-0 w-1 h-full bg-slate-300 group-hover:bg-blue-500 transition-colors"></div>
                      <div className="flex items-start justify-between gap-2 pl-2">
                        <h4 className="font-bold text-slate-900">{roleLabel(role.name)}</h4>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 border border-slate-200 shrink-0">
                          {role.permissions.length} perms
                        </span>
                      </div>
                      <p className="mt-3 text-xs text-slate-500 leading-relaxed pl-2 h-12 overflow-hidden">{role.description}</p>
                    </div>
                  );
                })}
              </div>

              <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="bg-slate-50 p-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-6">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Security Matrix</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Showing {filteredPermissions.length} distinct system capabilities.
                    </p>
                  </div>
                  <div className="relative w-full max-w-md">
                     <svg className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                     <input
                       type="search"
                       placeholder="Filter matrix (e.g. EVIDENCE)..."
                       value={permQuery}
                       onChange={(e) => setPermQuery(e.target.value)}
                       className="w-full rounded-lg border-2 border-slate-200 pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:ring-0 outline-none transition-colors font-mono"
                     />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-200 bg-white">
                        <th className="py-4 px-6 font-bold uppercase tracking-wider text-slate-400 text-xs w-1/3">Capability</th>
                        {ROLES.map((roleName) => (
                          <th key={roleName} className="py-4 px-2 font-bold uppercase tracking-wider text-slate-600 text-[10px] text-center w-24">
                            <div className="-rotate-45 origin-left whitespace-nowrap translate-y-6 translate-x-4 mb-8">
                               {roleLabel(roleName).replace("Demo ", "")}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPermissions.map((perm) => (
                        <tr key={perm} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-6 font-mono text-xs font-bold text-slate-700">{perm}</td>
                          {ROLES.map((roleName) => {
                            const role = rolesData.items.find((r) => r.name === roleName);
                            const granted = role?.permissions.includes(perm);
                            return (
                              <td key={roleName} className="py-3 px-2 text-center">
                                {granted ? (
                                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-blue-100 text-blue-700 border border-blue-200 shadow-sm">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                  </span>
                                ) : (
                                  <span className="inline-block w-6 h-6 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-300">
                                    -
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredPermissions.length === 0 ? (
                    <div className="py-16 text-center text-slate-500 font-medium">No capabilities match "{permQuery}".</div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-8">
          {can(permissions, "USER.CREATE") ? (
            <form
              className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden"
              onSubmit={async (event) => {
                event.preventDefault();
                setError(null);
                setNotice(null);
                try {
                  const created = await apiFetch<UserRecord>("/api/users", {
                    method: "POST",
                    body: JSON.stringify({
                      username: draft.username.trim().toLowerCase(),
                      full_name: draft.full_name.trim(),
                      email: draft.email.trim().toLowerCase(),
                      password: draft.password,
                      role_name: draft.role_name,
                      department_id: draft.department_id,
                    }),
                  });
                  setUsers((current) => [created, ...(current ?? []).filter((row) => row.id !== created.id)]);
                  setDraft({
                    username: "",
                    full_name: "",
                    email: "",
                    password: "",
                    role_name: "POLICE_OFFICER",
                    department_id: departments[0]?.id ?? "",
                  });
                  setNotice(`Personnel enrolled: ${created.username}. They may authenticate immediately.`);
                } catch (caught: unknown) {
                  setError(caught instanceof ApiClientError ? caught.message : "The account could not be created.");
                }
              }}
            >
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200">
                 <h3 className="text-lg font-bold text-slate-900">Enroll New Personnel</h3>
                 <p className="text-xs text-slate-500 font-medium">Provision identity for cross-department access.</p>
              </div>
              <div className="p-6 grid gap-6 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700">Service ID (Username)</label>
                    <input
                      required
                      minLength={3}
                      maxLength={64}
                      pattern="[a-z0-9_]+"
                      value={draft.username}
                      onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                      className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors font-mono"
                      placeholder="officer2"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700">Full Name</label>
                    <input
                      required
                      minLength={3}
                      maxLength={200}
                      value={draft.full_name}
                      onChange={(event) => setDraft({ ...draft, full_name: event.target.value })}
                      className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors"
                      placeholder="John Doe"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700">Official Email</label>
                    <input
                      required
                      type="email"
                      maxLength={255}
                      value={draft.email}
                      onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                      className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors"
                      placeholder="jdoe@agency.gov"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700">Initial Password</label>
                    <input
                      required
                      type="password"
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      value={draft.password}
                      onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                      className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700">Clearance Role</label>
                    <select
                      value={draft.role_name}
                      onChange={(event) => setDraft({ ...draft, role_name: event.target.value })}
                      className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700">Assigned Department</label>
                    <select
                      required
                      value={draft.department_id}
                      onChange={(event) => setDraft({ ...draft, department_id: event.target.value })}
                      className="w-full rounded-md border-2 border-slate-200 px-3 py-2 text-sm focus:border-blue-500 outline-none transition-colors"
                    >
                      <option value="">Select a department</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </div>
              </div>
              <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 text-right">
                <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors px-6 py-2.5 text-sm font-bold text-white shadow-sm inline-flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Enroll Personnel
                </button>
              </div>
            </form>
          ) : null}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
             <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <h3 className="text-lg font-bold text-slate-900">Personnel Directory</h3>
                <div className="relative w-full max-w-sm">
                   <svg className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                   <input
                     value={query}
                     onChange={(event) => setQuery(event.target.value)}
                     className="w-full rounded-lg border-2 border-slate-200 pl-10 pr-4 py-2 text-sm focus:border-blue-500 outline-none transition-colors"
                     placeholder="Search personnel by name or role..."
                   />
                </div>
             </div>
             
             <div className="overflow-x-auto">
                {users === null && !error ? <div className="px-6 py-12 flex flex-col items-center justify-center text-slate-400"><svg className="animate-spin h-8 w-8 mb-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p className="font-medium text-sm">Loading registry...</p></div> : null}
                {users && visible.length === 0 ? <p className="px-6 py-12 text-center text-slate-500">No personnel match this search criteria.</p> : null}
                {users && visible.length > 0 ? (
                  <table className="w-full min-w-[50rem] text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-slate-500">Identity</th>
                        <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-slate-500">Clearance Role</th>
                        <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-slate-500">Assignment</th>
                        <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-slate-500">Status</th>
                        {can(permissions, "USER.UPDATE") ? <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-slate-500 text-right">Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visible.map((item) => {
                        const self = item.id === session.id;
                        return (
                          <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <span className="font-bold text-slate-900 block">{item.full_name}</span>
                              <span className="font-mono text-xs text-slate-500 mt-1 block">@{item.username}</span>
                            </td>
                            <td className="px-6 py-4">
                               <span className="inline-flex px-2.5 py-1 rounded bg-slate-100 text-slate-800 border border-slate-200 text-xs font-bold uppercase tracking-wider">
                                 {roleLabel(item.role.name)}
                               </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-slate-900 font-medium block">{item.department.name}</span>
                              <span className="font-mono text-xs text-slate-500 mt-1 block">{item.department.code}</span>
                            </td>
                            <td className="px-6 py-4">
                              {item.is_active ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-bold uppercase tracking-wider border border-green-200">
                                   <div className="w-1.5 h-1.5 rounded-full bg-green-600"></div> Active
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-wider border border-slate-200">
                                   <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div> Inactive
                                </span>
                              )}
                            </td>
                            {can(permissions, "USER.UPDATE") ? (
                              <td className="px-6 py-4">
                                {self ? (
                                  <div className="flex justify-end">
                                    <span className="px-3 py-1 bg-slate-100 text-slate-400 text-xs font-bold uppercase tracking-widest rounded border border-slate-200">Current User</span>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-end gap-2">
                                    <div className="flex gap-2 w-full max-w-[14rem]">
                                        <select
                                          className="w-1/2 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-500 outline-none"
                                          value={item.role.name}
                                          onChange={(event) => {
                                            const roleName = event.target.value;
                                            setConfirm({
                                              title: "Change Clearance Role?",
                                              message: `${item.full_name} will be assigned the role of ${roleLabel(roleName)}.`,
                                              confirmLabel: "Apply Role Change",
                                              run: async () => {
                                                const updated = await apiFetch<UserRecord>(`/api/users/${item.id}`, {
                                                  method: "PATCH",
                                                  body: JSON.stringify({ role_name: roleName }),
                                                });
                                                setUsers((current) => (current ?? []).map((row) => (row.id === updated.id ? updated : row)));
                                                setNotice("Role updated successfully.");
                                              },
                                            });
                                          }}
                                        >
                                          {ROLES.map((role) => (
                                            <option key={role} value={role}>
                                              {roleLabel(role).replace("Demo ", "")}
                                            </option>
                                          ))}
                                        </select>
                                      {departments.length > 0 ? (
                                          <select
                                            className="w-1/2 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-500 outline-none"
                                            value={departments.find((department) => department.code === item.department.code)?.id ?? ""}
                                            onChange={(event) => {
                                              const departmentId = event.target.value;
                                              const department = departments.find((row) => row.id === departmentId);
                                              setConfirm({
                                                title: "Reassign Department?",
                                                message: `${item.full_name} will be reassigned to ${department?.name ?? "the selected department"}.`,
                                                confirmLabel: "Apply Reassignment",
                                                run: async () => {
                                                  const updated = await apiFetch<UserRecord>(`/api/users/${item.id}`, {
                                                    method: "PATCH",
                                                    body: JSON.stringify({ department_id: departmentId }),
                                                  });
                                                  setUsers((current) => (current ?? []).map((row) => (row.id === updated.id ? updated : row)));
                                                  setNotice("Department reassignment successful.");
                                                },
                                              });
                                            }}
                                          >
                                            {departments.map((department) => (
                                              <option key={department.id} value={department.id}>
                                                {department.code}
                                              </option>
                                            ))}
                                          </select>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded border transition-colors ${item.is_active ? 'text-red-700 border-red-200 bg-red-50 hover:bg-red-100' : 'text-green-700 border-green-200 bg-green-50 hover:bg-green-100'}`}
                                      onClick={() =>
                                        setConfirm({
                                          title: item.is_active ? "Suspend Personnel Account?" : "Reactivate Personnel Account?",
                                          message: item.is_active
                                            ? `${item.username} will be signed out of protected resources.`
                                            : `${item.username} will be able to sign in again.`,
                                          confirmLabel: item.is_active ? "Suspend Account" : "Reactivate Account",
                                          run: async () => {
                                            const updated = await apiFetch<UserRecord>(`/api/users/${item.id}`, {
                                              method: "PATCH",
                                              body: JSON.stringify({ is_active: !item.is_active }),
                                            });
                                            setUsers((current) => (current ?? []).map((row) => (row.id === updated.id ? updated : row)));
                                            setNotice(updated.is_active ? "Account reactivated." : "Account suspended.");
                                          },
                                        })
                                      }
                                    >
                                      {item.is_active ? "Suspend" : "Activate"}
                                    </button>
                                  </div>
                                )}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : null}
             </div>
          </div>
        </div>
      )}
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

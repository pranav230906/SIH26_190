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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-navy">Identity & Access Administration</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          Manage system user accounts, institutional roles, and review the cross-departmental permission matrix.
        </p>
      </div>

      {notice ? <p className="rounded-md border border-line bg-white px-4 py-3 text-sm text-navy">{notice}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex border-b border-line gap-6 text-sm font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={`pb-3 border-b-2 transition-colors ${
            activeTab === "users"
              ? "border-navy text-navy font-semibold"
              : "border-transparent text-muted hover:text-navy"
          }`}
        >
          User Accounts Register
        </button>
        {can(permissions, "ROLE.READ") ? (
          <button
            type="button"
            onClick={() => setActiveTab("roles")}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === "roles"
                ? "border-navy text-navy font-semibold"
                : "border-transparent text-muted hover:text-navy"
            }`}
          >
            Roles & Permission Matrix
          </button>
        ) : null}
      </div>

      {activeTab === "roles" ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-line bg-white p-5">
            <h3 className="text-base font-semibold text-navy">Institutional Separation of Duties</h3>
            <p className="mt-1 text-sm text-muted">
              Role-Based Access Control (RBAC) enforces strict jurisdictional separation. System Administrators manage identities and system configuration, but have zero read or write access to criminal case content or evidence. Police, Forensics, Prosecution, and Judiciary operate within strictly segregated permissions.
            </p>
          </div>

          {rolesLoading ? (
            <p className="text-sm text-muted">Loading roles and permissions matrix...</p>
          ) : rolesData ? (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {ROLES.map((roleName) => {
                  const role = rolesData.items.find((r) => r.name === roleName);
                  if (!role) return null;
                  return (
                    <div key={role.id} className="rounded-lg border border-line bg-white p-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-navy">{roleLabel(role.name)}</h4>
                        <span className="rounded bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">
                          {role.permissions.length} perms
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-muted leading-relaxed">{role.description}</p>
                    </div>
                  );
                })}
              </div>

              <section className="rounded-lg border border-line bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-navy">Permission Matrix</h3>
                    <p className="text-sm text-muted">
                      Audit granted capabilities across all 7 institutional roles ({filteredPermissions.length} permissions shown).
                    </p>
                  </div>
                  <input
                    type="search"
                    placeholder="Filter permissions (e.g. EVIDENCE, COURT_PACKAGE)..."
                    value={permQuery}
                    onChange={(e) => setPermQuery(e.target.value)}
                    className="w-full max-w-xs rounded-md border border-line px-3 py-1.5 text-sm"
                  />
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-line bg-line/10">
                        <th className="py-2.5 px-3 font-semibold text-navy">Permission</th>
                        {ROLES.map((roleName) => (
                          <th key={roleName} className="py-2.5 px-2 font-semibold text-navy text-center">
                            {roleLabel(roleName).replace("Demo ", "")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {filteredPermissions.map((perm) => (
                        <tr key={perm} className="hover:bg-line/5">
                          <td className="py-2 px-3 font-mono font-medium text-navy">{perm}</td>
                          {ROLES.map((roleName) => {
                            const role = rolesData.items.find((r) => r.name === roleName);
                            const granted = role?.permissions.includes(perm);
                            return (
                              <td key={roleName} className="py-2 px-2 text-center">
                                {granted ? (
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                                    ✓
                                  </span>
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredPermissions.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted">No permissions match &quot;{permQuery}&quot;.</p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {can(permissions, "USER.CREATE") ? (
            <form
              className="grid gap-3 rounded-lg border border-line bg-white p-5 md:grid-cols-2"
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
                  setNotice(`${created.username} can sign in with the password you set.`);
                } catch (caught: unknown) {
                  setError(caught instanceof ApiClientError ? caught.message : "The account could not be created.");
                }
              }}
            >
              <h3 className="text-base font-semibold md:col-span-2">Create account</h3>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Username</span>
                <input
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-z0-9_]+"
                  value={draft.username}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                  className="w-full rounded-md border border-line px-3 py-2"
                  placeholder="officer2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Full name</span>
                <input
                  required
                  minLength={3}
                  maxLength={200}
                  value={draft.full_name}
                  onChange={(event) => setDraft({ ...draft, full_name: event.target.value })}
                  className="w-full rounded-md border border-line px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Email</span>
                <input
                  required
                  type="email"
                  maxLength={255}
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                  className="w-full rounded-md border border-line px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Initial password</span>
                <input
                  required
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                  className="w-full rounded-md border border-line px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Role</span>
                <select
                  value={draft.role_name}
                  onChange={(event) => setDraft({ ...draft, role_name: event.target.value })}
                  className="w-full rounded-md border border-line px-3 py-2"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted">Department</span>
                <select
                  required
                  value={draft.department_id}
                  onChange={(event) => setDraft({ ...draft, department_id: event.target.value })}
                  className="w-full rounded-md border border-line px-3 py-2"
                >
                  <option value="">Select a department</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="md:col-span-2">
                <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm text-white">
                  Create account
                </button>
              </div>
            </form>
          ) : null}
          <label className="block max-w-md text-sm">
            <span className="mb-1 block text-muted">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2"
              placeholder="Name, username, or role"
            />
          </label>
          <section className="overflow-x-auto rounded-lg border border-line bg-white">
            {users === null && !error ? <p className="px-5 py-4 text-sm text-muted">Loading users…</p> : null}
            {users && visible.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No users match this search.</p> : null}
            {users && visible.length > 0 ? (
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-medium">Account</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Department</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    {can(permissions, "USER.UPDATE") ? <th className="px-5 py-3 font-medium">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const self = item.id === session.id;
                    return (
                      <tr key={item.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-3">
                          <span className="font-medium">{item.full_name}</span>
                          <span className="block text-xs text-muted">{item.username}</span>
                        </td>
                        <td className="px-5 py-3">{roleLabel(item.role.name)}</td>
                        <td className="px-5 py-3">
                          {item.department.name}
                          <span className="block text-xs text-muted">{item.department.code}</span>
                        </td>
                        <td className="px-5 py-3">{item.is_active ? "Active" : "Inactive"}</td>
                        {can(permissions, "USER.UPDATE") ? (
                          <td className="px-5 py-3">
                            {self ? (
                              <span className="text-xs text-muted">Your account</span>
                            ) : (
                              <div className="flex flex-col items-start gap-2">
                                <label className="text-xs text-muted">
                                  Role
                                  <select
                                    className="mt-1 block rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
                                    value={item.role.name}
                                    onChange={(event) => {
                                      const roleName = event.target.value;
                                      setConfirm({
                                        title: "Change this user's role?",
                                        message: `${item.full_name} will become ${roleLabel(roleName)}.`,
                                        confirmLabel: "Change role",
                                        run: async () => {
                                          const updated = await apiFetch<UserRecord>(`/api/users/${item.id}`, {
                                            method: "PATCH",
                                            body: JSON.stringify({ role_name: roleName }),
                                          });
                                          setUsers((current) => (current ?? []).map((row) => (row.id === updated.id ? updated : row)));
                                          setNotice("Role updated.");
                                        },
                                      });
                                    }}
                                  >
                                    {ROLES.map((role) => (
                                      <option key={role} value={role}>
                                        {roleLabel(role)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {departments.length > 0 ? (
                                  <label className="text-xs text-muted">
                                    Department
                                    <select
                                      className="mt-1 block rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
                                      value={departments.find((department) => department.code === item.department.code)?.id ?? ""}
                                      onChange={(event) => {
                                        const departmentId = event.target.value;
                                        const department = departments.find((row) => row.id === departmentId);
                                        setConfirm({
                                          title: "Change this user's department?",
                                          message: `${item.full_name} will move to ${department?.name ?? "the selected department"}.`,
                                          confirmLabel: "Change department",
                                          run: async () => {
                                            const updated = await apiFetch<UserRecord>(`/api/users/${item.id}`, {
                                              method: "PATCH",
                                              body: JSON.stringify({ department_id: departmentId }),
                                            });
                                            setUsers((current) => (current ?? []).map((row) => (row.id === updated.id ? updated : row)));
                                            setNotice("Department updated.");
                                          },
                                        });
                                      }}
                                    >
                                      {departments.map((department) => (
                                        <option key={department.id} value={department.id}>
                                          {department.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                <button
                                  type="button"
                                  className="text-sm text-danger underline-offset-4 hover:underline"
                                  onClick={() =>
                                    setConfirm({
                                      title: item.is_active ? "Deactivate this account?" : "Activate this account?",
                                      message: item.is_active
                                        ? `${item.username} will be signed out of protected resources.`
                                        : `${item.username} will be able to sign in again.`,
                                      confirmLabel: item.is_active ? "Deactivate" : "Activate",
                                      run: async () => {
                                        const updated = await apiFetch<UserRecord>(`/api/users/${item.id}`, {
                                          method: "PATCH",
                                          body: JSON.stringify({ is_active: !item.is_active }),
                                        });
                                        setUsers((current) => (current ?? []).map((row) => (row.id === updated.id ? updated : row)));
                                        setNotice(updated.is_active ? "Account activated." : "Account deactivated.");
                                      },
                                    })
                                  }
                                >
                                  {item.is_active ? "Deactivate" : "Activate"}
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
          </section>
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

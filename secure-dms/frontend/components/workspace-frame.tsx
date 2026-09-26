"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/api";
import type { MeResponse, PermissionsResponse } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/components/session-context";

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<MeResponse | null>(null);
  const [permissions, setPermissions] = useState<PermissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetch<MeResponse>("/api/auth/me"), apiFetch<PermissionsResponse>("/api/auth/permissions")])
      .then(([account, grants]) => {
        if (!cancelled) {
          setSession(account);
          setPermissions(grants);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        if (caught instanceof ApiClientError && (caught.status === 401 || caught.code === "unauthorized")) {
          router.replace("/login");
          return;
        }
        const message = caught instanceof ApiClientError ? caught.message : "The workspace could not be opened.";
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">Workspace unavailable</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-danger">
          {error}
        </p>
      </main>
    );
  }

  if (!session || !permissions) {
    return <p className="px-8 py-10 text-sm text-muted">Checking session…</p>;
  }

  return (
    <SessionProvider session={session} permissions={permissions}>
      <AppShell user={session}>{children}</AppShell>
    </SessionProvider>
  );
}

"use client";

import { createContext, useContext } from "react";
import type { MeResponse, PermissionsResponse } from "@/lib/types";

const SessionContext = createContext<MeResponse | null>(null);
const PermissionsContext = createContext<PermissionsResponse | null>(null);

export function SessionProvider({
  session,
  permissions,
  children,
}: {
  session: MeResponse;
  permissions: PermissionsResponse;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>
      <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession(): MeResponse {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("Session is not available.");
  }
  return session;
}

export function usePermissions(): PermissionsResponse {
  const permissions = useContext(PermissionsContext);
  if (!permissions) {
    throw new Error("Permissions are not available.");
  }
  return permissions;
}

export function can(permissions: string[], code: string): boolean {
  return permissions.includes(code);
}

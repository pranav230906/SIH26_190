"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { roleLabel } from "@/lib/format";
import { API_URL } from "@/lib/api";
import { clearSession, getRefreshToken } from "@/lib/session";
import type { MeResponse } from "@/lib/types";

export function TopNav({
  title,
  user,
  onOpenNav,
}: {
  title: string;
  user: MeResponse;
  onOpenNav: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function confirmLogout() {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          cache: "no-store",
        });
      }
    } finally {
      clearSession();
      dialogRef.current?.close();
      router.replace("/login");
    }
  }

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-line bg-white px-4 py-3 sm:px-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md border border-line px-3 py-1.5 text-sm lg:hidden"
          onClick={onOpenNav}
        >
          Menu
        </button>
        <div>
          <p className="text-xs tracking-[0.14em] text-muted uppercase">Secure DMS</p>
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-ink">{user.full_name}</p>
          <p className="text-xs text-muted">{roleLabel(user.role.name)}</p>
        </div>
        <button
          type="button"
          className="rounded-md border border-line px-3 py-1.5 text-sm"
          onClick={() => dialogRef.current?.showModal()}
        >
          Sign out
        </button>
      </div>
      <dialog ref={dialogRef} className="w-[min(100%,24rem)] rounded-lg border border-line bg-white p-6 text-ink">
        <h2 className="text-lg font-semibold">Sign out</h2>
        <p className="mt-2 text-sm leading-6 text-muted">This ends the current session on this browser.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1.5 text-sm"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
          <button type="button" className="rounded-md bg-navy px-3 py-1.5 text-sm text-white" onClick={confirmLogout}>
            Sign out
          </button>
        </div>
      </dialog>
    </header>
  );
}

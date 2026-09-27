"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { roleLabel } from "@/lib/format";
import { API_URL } from "@/lib/api";
import { clearSession, getRefreshToken } from "@/lib/session";
import type { MeResponse } from "@/lib/types";
import { can, usePermissions } from "@/components/session-context";

import { SyncIndicator } from "@/components/sync-indicator";

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

  // Get initials for avatar
  const initials = user.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6 lg:px-8">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden transition-colors"
            onClick={onOpenNav}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="hidden sm:flex items-center text-sm">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px]">Workspace</span>
            <svg className="h-3 w-3 mx-2 text-slate-300" fill="currentColor" viewBox="0 0 20 20">
               <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-bold text-slate-900">{title}</span>
          </div>
        </div>
      </div>
      <div className="flex-1 max-w-2xl mx-8 hidden md:block">
        <form
           onSubmit={(e) => {
             e.preventDefault();
             const fd = new FormData(e.currentTarget);
             const q = fd.get('q');
             if (q) router.push(`/search?q=${encodeURIComponent(q.toString())}`);
           }}
           className="relative group"
        >
          <svg className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 group-focus-within:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            name="q"
            className="w-full bg-slate-100 border border-transparent text-sm rounded-lg pl-9 pr-4 py-2 text-slate-900 placeholder:text-slate-500 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
            placeholder="Global Search (Ctrl+K)..."
          />
          <div className="absolute right-2 top-2 border border-slate-300 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">Ctrl K</div>
        </form>
      </div>
      <div className="flex items-center gap-5">
        <SyncIndicator />
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold text-slate-900">{user.full_name}</p>
            <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{roleLabel(user.role.name)}</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700 ring-2 ring-white">
            {initials}
          </div>
        </div>
        <div className="h-6 w-px bg-slate-200"></div>
        <button
          type="button"
          className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
          onClick={() => dialogRef.current?.showModal()}
        >
          Sign out
        </button>
      </div>
      <dialog ref={dialogRef} className="w-[min(100%,24rem)] rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-900/50 open:animate-in open:fade-in open:zoom-in-95">
        <div className="flex items-center gap-3 text-red-600 mb-2">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          <h2 className="text-lg font-bold">Terminate Session</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 font-medium">This will immediately revoke access and end your current secure session on this terminal.</p>
        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
          <button type="button" className="rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors shadow-sm inline-flex items-center gap-2" onClick={confirmLogout}>
            Confirm Sign Out
          </button>
        </div>
      </dialog>
    </header>
  );
}

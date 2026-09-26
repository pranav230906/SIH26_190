"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { MeResponse } from "@/lib/types";
import { Sidebar } from "@/components/sidebar";
import { TopNav } from "@/components/top-nav";

function titleFor(pathname: string): string {
  if (pathname.startsWith("/forensics/work-queue")) {
    return "Forensic work queue";
  }
  if (pathname.startsWith("/forensics/reviews")) {
    return "Forensic reviews";
  }
  if (pathname.startsWith("/forensic-requests/")) {
    return "Forensic request";
  }
  if (pathname.includes("/forensics")) {
    return "Forensic requests";
  }
  if (pathname.startsWith("/artifacts/")) {
    return "Derived artifact";
  }
  if (pathname.startsWith("/evidence/")) {
    return "Evidence";
  }
  if (pathname.includes("/evidence")) {
    return "Evidence vault";
  }
  if (pathname.startsWith("/audit")) {
    return "Security audit";
  }
  if (pathname.startsWith("/assistant")) {
    return "Case assistant";
  }
  if (pathname.startsWith("/search")) {
    return "Search";
  }
  if (pathname.startsWith("/documents/")) {
    return "Document";
  }
  if (pathname.includes("/documents")) {
    return "Documents";
  }
  if (pathname.startsWith("/cases/")) {
    return "Case";
  }
  if (pathname.startsWith("/cases")) {
    return "Cases";
  }
  if (pathname.startsWith("/dashboard")) {
    return "Dashboard";
  }
  if (pathname.startsWith("/requests")) {
    return "Requests";
  }
  if (pathname.startsWith("/users")) {
    return "Users";
  }
  if (pathname.startsWith("/departments")) {
    return "Departments";
  }
  return "Secure DMS";
}

export function AppShell({ user, children }: { user: MeResponse; children: React.ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNavOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-paper text-ink lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-col">
        <TopNav title={titleFor(pathname)} user={user} onOpenNav={() => setNavOpen(true)} />
        <main id="main" className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

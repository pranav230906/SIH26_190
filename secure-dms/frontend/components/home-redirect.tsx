"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasSession } from "@/lib/session";

export function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(hasSession() ? "/dashboard" : "/login");
  }, [router]);

  return <p className="px-8 py-10 text-sm text-muted">Opening the workspace…</p>;
}

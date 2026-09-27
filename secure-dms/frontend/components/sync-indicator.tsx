"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { OfflineSyncQueue, type OfflineItem } from "@/lib/offline-store";

export function SyncIndicator() {
  const isOnline = useNetworkStatus();
  const [items, setItems] = useState<OfflineItem[]>([]);

  useEffect(() => {
    // Poll the queue to update the indicator. In a real app we'd use events,
    // but a 2-second interval is fine for the demo.
    const loadItems = async () => {
      try {
        const queued = await OfflineSyncQueue.getAll();
        setItems(queued);
      } catch (err) {
        // ignore
      }
    };
    
    loadItems();
    const interval = setInterval(loadItems, 2000);
    return () => clearInterval(interval);
  }, []);

  const pending = items.filter(i => ["QUEUED", "UPLOADING"].includes(i.status)).length;
  const error = items.filter(i => ["FAILED", "SECURITY_REJECTED", "AUTHORIZATION_FAILED", "HASH_MISMATCH"].includes(i.status)).length;

  if (isOnline && items.length === 0) {
    return (
      <Link href="/sync" className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
        </span>
        Online
      </Link>
    );
  }

  if (!isOnline) {
    return (
      <Link href="/sync" className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors shadow-sm">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        Offline Mode
        {pending > 0 && <span className="ml-1 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px]">{pending}</span>}
      </Link>
    );
  }

  if (error > 0) {
    return (
      <Link href="/sync" className="flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors shadow-sm">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        {error} item{error !== 1 ? 's' : ''} requires attention
      </Link>
    );
  }

  if (pending > 0) {
    return (
      <Link href="/sync" className="flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors shadow-sm">
        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        Syncing {pending} item{pending !== 1 ? 's' : ''}
      </Link>
    );
  }

  return null;
}

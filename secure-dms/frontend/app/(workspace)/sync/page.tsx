"use client";

import { useEffect, useState } from "react";
import { formatTimestamp, formatFileSize } from "@/lib/format";
import { OfflineSyncQueue, type OfflineItem } from "@/lib/offline-store";
import { SyncManager } from "@/components/sync-manager";
import { StatusBadge } from "@/components/status-badge";
import { useNetworkStatus } from "@/hooks/use-network-status";

export default function SyncCenterPage() {
  const [items, setItems] = useState<OfflineItem[]>([]);
  const isOnline = useNetworkStatus();

  const loadItems = async () => {
    try {
      const queued = await OfflineSyncQueue.getAll();
      setItems(queued.sort((a, b) => b.id! - a.id!));
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => {
    loadItems();
    const interval = setInterval(loadItems, 2000);
    return () => clearInterval(interval);
  }, []);

  const pending = items.filter(i => ["QUEUED", "UPLOADING"].includes(i.status)).length;
  const synced = items.filter(i => i.status === "SYNCED").length;
  const failed = items.filter(i => ["FAILED", "SECURITY_REJECTED", "AUTHORIZATION_FAILED", "HASH_MISMATCH"].includes(i.status)).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">Offline Sync</h1>

      <div className="flex gap-4 mb-6">
        <div className="rounded-lg border border-line bg-white p-4 shadow-sm flex-1">
          <p className="text-sm text-muted">Connection</p>
          <p className={`text-lg font-bold ${isOnline ? "text-emerald-600" : "text-amber-600"}`}>
            {isOnline ? "● Online" : "⚠ Offline Mode"}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 shadow-sm flex-1">
          <p className="text-sm text-muted">Pending</p>
          <p className="text-lg font-bold text-blue-600">{pending}</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 shadow-sm flex-1">
          <p className="text-sm text-muted">Synced</p>
          <p className="text-lg font-bold text-emerald-600">{synced}</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4 shadow-sm flex-1">
          <p className="text-sm text-muted">Failed</p>
          <p className="text-lg font-bold text-red-600">{failed}</p>
        </div>
      </div>

      <div className="space-y-4">
        {items.length === 0 ? (
          <p className="text-muted">No items in the offline queue.</p>
        ) : (
          items.map(item => (
            <div key={item.id} className="rounded-lg border border-line bg-white p-4 shadow-sm flex justify-between items-center">
              <div>
                <p className="font-semibold text-navy">{item.fileName}</p>
                <p className="text-sm text-muted">{item.caseId} · {formatFileSize(item.fileSize)}</p>
                {item.status === "SECURITY_REJECTED" && (
                   <p className="text-sm text-red-600 font-medium mt-1">Reason: Demo Security Scan rejected this file.</p>
                )}
                {item.status === "AUTHORIZATION_FAILED" && (
                   <p className="text-sm text-red-600 font-medium mt-1">Reason: You no longer have permission to upload this item to this case.</p>
                )}
                {item.status === "FAILED" && item.lastError && (
                   <p className="text-sm text-red-600 font-medium mt-1">Error: {item.lastError}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge 
                  status={
                    item.status === "SYNCED" ? "ACTIVE" : 
                    (item.status === "QUEUED" || item.status === "UPLOADING") ? "DRAFT" : "RESTRICTED"
                  } 
                  label={item.status === "QUEUED" && !isOnline ? "WAITING FOR CONNECTION" : item.status} 
                />
                {(item.status === "FAILED" || item.status === "SECURITY_REJECTED" || item.status === "AUTHORIZATION_FAILED") && (
                  <div className="flex gap-2">
                    {item.status === "FAILED" && (
                      <button 
                        onClick={() => OfflineSyncQueue.updateStatus(item.id!, { status: "QUEUED", retryCount: 0 })}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Retry
                      </button>
                    )}
                    <button 
                      onClick={() => OfflineSyncQueue.remove(item.id!)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <SyncManager onSyncComplete={loadItems} />
    </div>
  );
}

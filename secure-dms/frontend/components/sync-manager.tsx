"use client";

import { useEffect, useRef } from "react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { OfflineSyncQueue, type OfflineItem } from "@/lib/offline-store";
import { uploadWithProgress, ApiClientError } from "@/lib/api";

export function SyncManager({ onSyncComplete }: { onSyncComplete?: () => void }) {
  const isOnline = useNetworkStatus();
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!isOnline || syncingRef.current) return;

    const processQueue = async () => {
      syncingRef.current = true;
      try {
        const items = await OfflineSyncQueue.getAll();
        const pending = items.filter(i => i.status === "QUEUED" || (i.status === "FAILED" && i.retryCount < 3));

        for (const item of pending) {
          await OfflineSyncQueue.updateStatus(item.id!, { status: "UPLOADING" });
          if (onSyncComplete) onSyncComplete();

          const form = new FormData();
          form.set("file", item.file);
          
          for (const [key, value] of Object.entries(item.metadata)) {
            if (value !== undefined && value !== null) {
              form.set(key, value);
            }
          }

          const path = item.itemType === "DOCUMENT" 
            ? `/api/cases/${item.caseId}/documents` 
            : `/api/cases/${item.caseId}/evidence`;

          try {
            const created = await uploadWithProgress<any>(path, form, () => undefined);
            
            await OfflineSyncQueue.updateStatus(item.id!, { 
              status: "SYNCED", 
              serverRecordId: created.id 
            });
          } catch (caught: any) {
            let status: OfflineItem["status"] = "FAILED";
            let lastError = caught instanceof Error ? caught.message : String(caught);
            
            if (caught instanceof ApiClientError) {
              if (caught.status === 403) {
                status = "AUTHORIZATION_FAILED";
              } else if (caught.status === 400 && caught.code === "security_blocked") {
                status = "SECURITY_REJECTED";
              }
            }
            
            await OfflineSyncQueue.updateStatus(item.id!, { 
              status, 
              lastError,
              retryCount: item.retryCount + 1
            });
          }
          if (onSyncComplete) onSyncComplete();
        }
      } finally {
        syncingRef.current = false;
      }
    };

    processQueue();
  }, [isOnline, onSyncComplete]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="w-[min(100%,28rem)] fixed inset-0 m-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl backdrop:bg-slate-900/50 open:animate-in open:fade-in open:zoom-in-95 text-slate-900"
      onClose={onCancel}
    >
      <div className="flex items-center gap-3 text-slate-900 mb-2">
         {/* If it's a destructive action (like deactivate or reject), we could conditionally change the icon, but for now we'll use a standard alert icon */}
         <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
           <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
         </div>
         <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-500 font-medium pl-13">{message}</p>
      
      <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors focus:ring-2 focus:ring-slate-200 outline-none"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-60 hover:bg-blue-700 shadow-sm transition-all focus:ring-4 focus:ring-blue-500/20 outline-none flex items-center gap-2"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Processing...
            </>
          ) : (
            confirmLabel
          )}
        </button>
      </div>
    </dialog>
  );
}

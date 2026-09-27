import Link from "next/link";
import { caseTypeLabel, formatDay, statusLabel } from "@/lib/format";
import type { CaseSummary } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";

export function CaseCard({ item }: { item: CaseSummary }) {
  return (
    <article className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-blue-300 transition-all duration-300 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full bg-slate-200 group-hover:bg-blue-500 transition-colors" />
      <div className="flex justify-between items-start gap-4 mb-4">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">{item.case_number}</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900 leading-tight group-hover:text-blue-700 transition-colors line-clamp-2">{item.title}</h3>
        </div>
        <div className="flex-shrink-0">
          <StatusBadge status={item.status} />
        </div>
      </div>
      
      <div className="flex-1 mt-2">
        <dl className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Classification</dt>
            <dd className="mt-1 font-semibold text-slate-700">{caseTypeLabel(item.case_type)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Department</dt>
            <dd className="mt-1 font-semibold text-slate-700 truncate" title={item.department?.name ?? "Not recorded"}>
              {item.department?.name ?? "Not recorded"}
            </dd>
          </div>
          <div className="col-span-2 bg-slate-50 rounded-lg p-3 border border-slate-100">
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Primary Officer</dt>
            <dd className="mt-1 font-semibold text-slate-800 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[10px] text-slate-600">
                {item.primary_officer_name?.[0]?.toUpperCase() ?? "?"}
              </span>
              {item.primary_officer_name ?? "Not assigned"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Last Updated</p>
          <p className="text-xs font-semibold text-slate-600 font-mono mt-0.5">{formatDay(item.updated_at)}</p>
        </div>
        <Link
          href={`/cases/${item.id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-blue-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-colors"
        >
          View Case
          <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </Link>
      </div>
      <p className="sr-only">Status {statusLabel(item.status)}</p>
    </article>
  );
}

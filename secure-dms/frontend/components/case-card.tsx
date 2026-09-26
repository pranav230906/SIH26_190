import Link from "next/link";
import { caseTypeLabel, formatDay, statusLabel } from "@/lib/format";
import type { CaseSummary } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";

export function CaseCard({ item }: { item: CaseSummary }) {
  return (
    <article className="flex h-full flex-col rounded-lg border border-line bg-white p-5">
      <p className="font-mono text-xs text-muted">{item.case_number}</p>
      <h3 className="mt-2 text-base font-semibold">{item.title}</h3>
      <div className="mt-3">
        <StatusBadge status={item.status} />
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Type</dt>
          <dd>{caseTypeLabel(item.case_type)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Department</dt>
          <dd className="text-right">{item.department?.name ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt className="text-muted">Primary officer</dt>
          <dd className="mt-1">{item.primary_officer_name ?? "Not assigned"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Updated</dt>
          <dd>{formatDay(item.updated_at)}</dd>
        </div>
      </dl>
      <p className="sr-only">Status {statusLabel(item.status)}</p>
      <Link
        href={`/cases/${item.id}`}
        className="mt-5 inline-flex w-fit rounded-md bg-navy px-3 py-2 text-sm text-white"
      >
        Open case
      </Link>
    </article>
  );
}

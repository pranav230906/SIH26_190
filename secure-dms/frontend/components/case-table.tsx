import Link from "next/link";
import { caseTypeLabel, formatDay } from "@/lib/format";
import type { CaseSummary } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";

export function CaseTable({ items }: { items: CaseSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <caption className="sr-only">Authorized cases</caption>
        <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">Case number</th>
            <th scope="col" className="px-5 py-3 font-medium">Title</th>
            <th scope="col" className="px-5 py-3 font-medium">Status</th>
            <th scope="col" className="px-5 py-3 font-medium">Department</th>
            <th scope="col" className="px-5 py-3 font-medium">Primary officer</th>
            <th scope="col" className="px-5 py-3 font-medium">Updated</th>
            <th scope="col" className="px-5 py-3 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-line last:border-0">
              <td className="px-5 py-3 font-medium">{item.case_number}</td>
              <td className="px-5 py-3">
                {item.title}
                <span className="mt-1 block text-xs text-muted">{caseTypeLabel(item.case_type)}</span>
              </td>
              <td className="px-5 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-5 py-3">{item.department?.name ?? "Not recorded"}</td>
              <td className="px-5 py-3">{item.primary_officer_name ?? "Not assigned"}</td>
              <td className="px-5 py-3 text-muted">{formatDay(item.updated_at)}</td>
              <td className="p-0">
                <Link href={`/cases/${item.id}`} className="block px-5 py-3 font-medium text-navy underline-offset-4 hover:underline">
                  Open case
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

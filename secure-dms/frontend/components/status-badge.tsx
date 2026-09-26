import { statusLabel } from "@/lib/format";

const TONES: Record<string, string> = {
  DRAFT: "border-line bg-paper text-muted",
  ACTIVE: "border-[#c5d4e4] bg-[#eef3f8] text-navy",
  UNDER_INVESTIGATION: "border-[#e4d3ae] bg-[#f8f3e8] text-[#6d5424]",
  UNDER_REVIEW: "border-[#c5d4e4] bg-white text-navy",
  READY_FOR_PROSECUTION: "border-[#e4d3ae] bg-white text-[#6d5424]",
  IN_COURT: "border-navy bg-navy text-white",
  CLOSED: "border-line bg-paper text-muted",
  ARCHIVED: "border-line bg-paper text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONES[status] ?? "border-line bg-white text-navy";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

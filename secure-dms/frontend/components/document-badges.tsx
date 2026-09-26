import { documentClassificationLabel, documentStatusLabel, documentTypeLabel } from "@/lib/format";

const CLASSIFICATION_TONES: Record<string, string> = {
  INTERNAL: "border-line bg-paper text-muted",
  CONFIDENTIAL: "border-[#e4d3ae] bg-[#f8f3e8] text-[#6d5424]",
  HIGHLY_CONFIDENTIAL: "border-[#c5d4e4] bg-[#eef3f8] text-navy",
  RESTRICTED: "border-navy/30 bg-white text-navy",
};

const STATUS_TONES: Record<string, string> = {
  DRAFT: "border-line bg-paper text-muted",
  UNDER_REVIEW: "border-[#e4d3ae] bg-white text-[#6d5424]",
  APPROVED: "border-[#c5d4e4] bg-[#eef3f8] text-navy",
  SEALED: "border-navy bg-navy text-white",
  ARCHIVED: "border-line bg-paper text-muted",
};

export function DocumentTypeBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full border border-line bg-white px-2 py-0.5 text-xs font-medium text-navy">
      {documentTypeLabel(value)}
    </span>
  );
}

export function DocumentClassificationBadge({ value }: { value: string }) {
  const tone = CLASSIFICATION_TONES[value] ?? "border-line bg-white text-navy";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {documentClassificationLabel(value)}
    </span>
  );
}

export function DocumentStatusBadge({ value }: { value: string }) {
  const tone = STATUS_TONES[value] ?? "border-line bg-white text-navy";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {documentStatusLabel(value)}
    </span>
  );
}

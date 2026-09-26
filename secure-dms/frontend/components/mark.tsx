export function Mark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const className =
    tone === "light"
      ? "grid h-10 w-10 place-items-center rounded-md border border-white/30 text-[11px] font-semibold tracking-wide text-white"
      : "grid h-10 w-10 place-items-center rounded-md bg-navy text-[11px] font-semibold tracking-wide text-white";

  return (
    <span className={className} aria-hidden="true">
      DMS
    </span>
  );
}

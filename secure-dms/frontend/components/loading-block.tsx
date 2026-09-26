export function LoadingBlock({ label = "Loading", lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div className="space-y-3 px-5 py-4" role="status" aria-live="polite">
      <p className="text-sm text-muted">{label}</p>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className={`h-4 rounded bg-line/80 ${index === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

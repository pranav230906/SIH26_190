"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-xs font-medium tracking-[0.16em] text-muted uppercase">Secure DMS</p>
      <h1 className="mt-3 text-2xl font-semibold text-ink">This page could not be displayed</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        The application hit an unexpected problem. Technical details are not shown in the interface.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 w-fit rounded-md bg-navy px-4 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </main>
  );
}

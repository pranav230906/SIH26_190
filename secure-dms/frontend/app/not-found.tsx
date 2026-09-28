import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-xs font-medium tracking-[0.16em] text-muted uppercase">RAKSHA</p>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mt-3 text-sm leading-6 text-muted">That address is not part of this prototype.</p>
      <Link href="/login" className="mt-6 w-fit text-sm font-medium text-navy underline-offset-4 hover:underline">
        Return to sign in
      </Link>
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/api";
import { hasSession, setTokens } from "@/lib/session";
import type { TokenResponse } from "@/lib/types";
import { Mark } from "@/components/mark";

const DEMO_USERS = [
  "admin1",
  "police1",
  "supervisor1",
  "forensic1",
  "forensic_reviewer1",
  "prosecutor1",
  "court1",
];

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hasSession()) {
      router.replace("/dashboard");
    }
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const tokens = await apiFetch<TokenResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setTokens(tokens.access_token, tokens.refresh_token);
      router.replace("/dashboard");
    } catch (caught) {
      const message = caught instanceof ApiClientError ? caught.message : "Sign-in could not be completed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between bg-navy px-12 py-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Mark tone="light" />
          <div>
            <p className="text-xs tracking-[0.18em] uppercase text-white/70">Secure DMS</p>
            <p className="text-sm text-white/80">Case records prototype</p>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl leading-tight font-semibold">Document workspace for investigation and judicial review.</h1>
          <p className="mt-5 text-base leading-7 text-white/75">
            Cases and assignments are the center of the record. This environment contains fictional demonstration data only.
          </p>
        </div>
        <p className="text-xs text-white/55">Development prototype. Not for operational use.</p>
      </aside>

      <main className="flex items-center justify-center bg-paper px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Mark />
            <div>
              <p className="text-xs tracking-[0.16em] text-muted uppercase">Secure DMS</p>
              <p className="text-sm font-medium">Case records prototype</p>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white px-6 py-7 shadow-sm sm:px-8">
            <h2 className="text-2xl font-semibold text-ink">Sign in</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Use a development account to open the workspace.</p>

            <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-ink">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-ink">
                  Password
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="rounded-md border border-line px-3 text-sm text-ink"
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error ? (
                <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                aria-busy={submitting}
                className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>

          <details className="mt-4 rounded-lg border border-line bg-white px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-ink">Development credentials</summary>
            <p className="mt-3 leading-6 text-muted">
              These accounts are fictional and for local demonstration only. Every account uses the password{" "}
              <span className="font-mono text-ink">DevOnly#2026</span>.
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-ink">
              {DEMO_USERS.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </details>
        </div>
      </main>
    </div>
  );
}

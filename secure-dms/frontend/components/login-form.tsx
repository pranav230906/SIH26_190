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
      <aside className="hidden flex-col justify-between bg-slate-900 px-12 py-12 text-white lg:flex border-r-4 border-blue-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/bg-pattern.svg')] opacity-5"></div>
        <div className="relative z-10 flex items-center gap-3">
          <Mark tone="light" />
          <div>
            <p className="text-xs font-bold tracking-[0.2em] uppercase text-slate-300">Secure DMS</p>
            <p className="text-sm font-medium text-slate-400">Classified Workspace</p>
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl leading-tight font-bold text-white tracking-wide">
             Authorized Document Management System
          </h1>
          <div className="w-16 h-1.5 bg-blue-500 mt-6 mb-4 rounded-full"></div>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            Secure investigation and judicial review platform. Access is restricted to authorized personnel. This environment contains fictional demonstration data only.
          </p>
        </div>
        <div className="relative z-10">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Development Prototype</p>
          <p className="text-[10px] text-slate-600 uppercase tracking-widest mt-1">Not for operational use</p>
        </div>
      </aside>

      <main className="flex items-center justify-center bg-slate-50 px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden justify-center">
            <Mark />
            <div>
              <p className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase">Secure DMS</p>
              <p className="text-sm font-medium text-slate-900">Classified Workspace</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-600"></div>
            <h2 className="text-2xl font-bold text-slate-900 uppercase tracking-wide">Authenticate</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 font-medium">Use a provisioned development account to open the secure workspace.</p>

            <form className="mt-8 space-y-5" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor="username" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Service ID (Username)
                </label>
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="mt-2 w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all text-slate-900"
                  placeholder="e.g. officer2"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Password
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="rounded-lg border-2 border-slate-200 px-4 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error ? (
                <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-red-800 text-sm font-medium shadow-sm">
                  <svg className="w-5 h-5 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> 
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                aria-busy={submitting}
                className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold tracking-wide uppercase text-white disabled:opacity-60 shadow-md hover:bg-blue-700 hover:shadow-lg transition-all flex items-center justify-center gap-2 mt-2"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Authenticating...
                  </>
                ) : (
                  <>
                    Sign In Securely
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

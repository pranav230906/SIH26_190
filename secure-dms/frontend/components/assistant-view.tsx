"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/api";
import type { RagCasesResponse, RagCitation, RagQueryResponse } from "@/lib/types";

type Turn = {
  question: string;
  answer: string;
  grounding: string;
  citations: RagCitation[];
  authorizedDocuments: number;
  retrievedSources: number;
};

export function AssistantView() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<RagCasesResponse | null>(null);
  const [caseId, setCaseId] = useState("");
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<RagCasesResponse>("/api/rag/cases")
      .then((data) => {
        setCatalog(data);
        setCaseId((current) => current || data.cases[0]?.id || "");
      })
      .catch((caught) => {
        setError(caught instanceof ApiClientError ? caught.message : "The case list could not be loaded.");
      });
  }, []);

  const selected = catalog?.cases.find((item) => item.id === caseId) ?? null;

  function changeCase(next: string) {
    setCaseId(next);
    setConversationId(null);
    setTurns([]);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || !caseId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<RagQueryResponse>("/api/rag/query", {
        method: "POST",
        body: JSON.stringify({
          case_id: caseId,
          question: text,
          conversation_id: conversationId,
        }),
      });
      setConversationId(data.conversation_id);
      setTurns((current) => [
        ...current,
        {
          question: text,
          answer: data.answer,
          grounding: data.grounding_status,
          citations: data.citations,
          authorizedDocuments: data.authorized_documents,
          retrievedSources: data.retrieved_sources,
        },
      ]);
      setQuestion("");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The case assistant could not answer.");
    } finally {
      setBusy(false);
    }
  }

  function openCitation(citation: RagCitation) {
    if (citation.artifact_id) {
      router.push(`/artifacts/${citation.artifact_id}`);
      return;
    }
    if (citation.document_id) {
      const params = new URLSearchParams();
      if (citation.page_number) params.set("page", String(citation.page_number));
      if (citation.version_id) params.set("version", citation.version_id);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      router.push(`/documents/${citation.document_id}${suffix}`);
      return;
    }
    if (citation.evidence_id) {
      router.push(`/evidence/${citation.evidence_id}`);
    }
  }

  const latest = turns[turns.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="space-y-4">
        <header className="rounded-lg border border-line bg-white p-6">
          <p className="text-xs font-semibold tracking-wide text-muted">CASE ASSISTANT</p>
          <h2 className="mt-1 text-2xl font-semibold text-navy">Authorized case context</h2>
          <p className="mt-2 text-sm text-muted">Ask about the documents and evidence you are allowed to read in the selected case.</p>
          {catalog?.demo_mode ? (
            <p className="mt-3 inline-flex rounded-md border border-line bg-paper px-2 py-1 text-xs font-semibold">DEMO MODE</p>
          ) : null}
          <label className="mt-4 block text-sm">
            Case
            <select value={caseId} onChange={(event) => changeCase(event.target.value)} className="mt-1 w-full rounded-md border border-line px-3 py-2">
              <option value="">Select a case</option>
              {(catalog?.cases ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.case_number} — {item.title}
                </option>
              ))}
            </select>
          </label>
          {selected ? <p className="mt-3 text-sm">Status: AUTHORIZED CASE CONTEXT · {selected.case_number}</p> : null}
        </header>

        <div className="space-y-4">
          {turns.map((turn, index) => (
            <article key={`${turn.question}-${index}`} className="space-y-3">
              <div className="rounded-lg border border-line bg-paper p-4">
                <p className="text-xs font-semibold text-muted">USER</p>
                <p className="mt-1 text-sm">{turn.question}</p>
              </div>
              <div className="rounded-lg border border-line bg-white p-4">
                <p className="text-xs font-semibold text-muted">ASSISTANT</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{turn.answer}</p>
                {turn.citations.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-muted">SOURCES</p>
                    <ol className="mt-2 space-y-2 text-sm">
                      {turn.citations.map((citation, citationIndex) => (
                        <li key={`${citation.chunk_id ?? citation.document_title}-${citationIndex}`}>
                          <button type="button" className="text-left text-navy underline" onClick={() => openCitation(citation)}>
                            [{citationIndex + 1}] {citation.document_title}
                            {citation.page_number ? ` — Page ${citation.page_number}` : ""}
                            {citation.version_label ? ` — ${citation.version_label}` : ""}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}

        <form onSubmit={submit} className="rounded-lg border border-line bg-white p-4">
          <label className="block text-sm font-medium text-navy">
            Ask about the authorized case documents
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-2 w-full rounded-md border border-line px-3 py-2 font-normal text-ink"
              placeholder="What vehicles were mentioned?"
            />
          </label>
          <button type="submit" disabled={busy || !caseId} className="mt-3 rounded-md bg-navy px-4 py-2 text-sm text-white">
            {busy ? "Working" : "Ask"}
          </button>
        </form>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-line bg-white p-4 text-sm">
          <h3 className="font-semibold text-navy">Case scope</h3>
          <p className="mt-3">Case: {selected?.case_number ?? "None selected"}</p>
          <p className="mt-2">Authorized documents: {latest ? latest.authorizedDocuments : "—"}</p>
          <p className="mt-2">Retrieved sources: {latest ? latest.retrievedSources : "—"}</p>
          <p className="mt-2">Answer: {latest ? latest.grounding.replaceAll("_", " ") : "Waiting"}</p>
        </section>
        <section className="rounded-lg border border-line bg-white p-4 text-sm">
          <h3 className="font-semibold text-navy">Sources</h3>
          {latest && latest.citations.length > 0 ? (
            <ol className="mt-3 space-y-3">
              {latest.citations.map((citation, index) => (
                <li key={`${citation.chunk_id ?? citation.document_title}-${index}`}>
                  <button type="button" className="text-left" onClick={() => openCitation(citation)}>
                    <span className="font-medium text-navy">{index + 1}. {citation.document_title}</span>
                    <span className="mt-1 block text-muted">
                      {citation.page_number ? `Page ${citation.page_number}` : "Page not recorded"}
                      {citation.version_label ? ` · Version ${citation.version_label}` : ""}
                    </span>
                  </button>
                  <p className="mt-1 text-muted">&quot;{citation.snippet}&quot;</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-muted">Sources appear after a grounded answer.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

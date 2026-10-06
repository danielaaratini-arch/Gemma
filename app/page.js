"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useGemmaSpeech } from "../components/useGemmaSpeech";

const GemmaAvatar = dynamic(() => import("../components/GemmaAvatar"), {
  ssr: false,
});

const STORAGE_KEY = "gemma-preview-conversation-v1";
const welcome = {
  role: "assistant",
  content: "Ciao, sono Gemma. Come posso aiutarti oggi?",
};

function restoreConversation() {
  if (typeof window === "undefined") return [welcome];

  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (message) =>
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
    ) {
      return parsed.slice(-40);
    }
  } catch {}

  return [welcome];
}

function extractSpeechSegments(buffer, final = false) {
  const segments = [];
  let rest = buffer;

  while (true) {
    const match = rest.match(/^([\s\S]*?[.!?])(?=\s|$)/);
    if (!match) break;
    const segment = match[1].trim();
    if (segment) segments.push(segment);
    rest = rest.slice(match[0].length).trimStart();
  }

  if (!final && rest.length > 320) {
    const splitAt = rest.lastIndexOf(" ", 280);
    if (splitAt > 120) {
      segments.push(rest.slice(0, splitAt).trim());
      rest = rest.slice(splitAt + 1).trimStart();
    }
  }

  if (final && rest.trim()) {
    segments.push(rest.trim());
    rest = "";
  }

  return { segments, rest };
}

export default function Home() {
  const [messages, setMessages] = useState([welcome]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { isSpeaking: speaking, begin: beginSpeech, enqueue: enqueueSpeech, stop: stopSpeech } = useGemmaSpeech();
  const [metrics, setMetrics] = useState(null);
  const listRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    setMessages(restoreConversation());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {}
  }, [messages, hydrated]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  function newConversation() {
    abortRef.current?.abort();
    stopSpeech();
    setBusy(false);
    setMetrics(null);
    setMessages([welcome]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  async function submit(event) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    beginSpeech();

    const context = [...messages, { role: "user", content: question }].slice(-40);
    setMessages([...context, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setMetrics(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: context }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Errore");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let speechBuffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "metadata") {
            setMetrics((current) => ({ ...(current || {}), ...event }));
          }

          if (event.type === "delta") {
            const delta = String(event.content || "");
            answer += delta;
            speechBuffer += delta;

            setMessages((current) => {
              const next = [...current];
              next[next.length - 1] = { role: "assistant", content: answer };
              return next;
            });

            const extracted = extractSpeechSegments(speechBuffer, false);
            speechBuffer = extracted.rest;
            for (const segment of extracted.segments) {
              enqueueSpeech(segment);
            }
          }

          if (event.type === "done") {
            setMetrics((current) => ({ ...(current || {}), ...event }));
          }

          if (event.type === "error") {
            throw new Error(event.error || "Errore");
          }
        }
      }

      const finalSpeech = extractSpeechSegments(speechBuffer, true);
      for (const segment of finalSpeech.segments) {
        enqueueSpeech(segment);
      }
    } catch (error) {
      if (error?.name === "AbortError") return;

      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = {
          role: "assistant",
          content:
            error?.message ||
            "Ho avuto un problema momentaneo nel generare la risposta. Riprova.",
        };
        return next;
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  const status = speaking ? "speaking" : busy ? "thinking" : "idle";

  return (
    <main className="shell">
      <section className="app">
        <aside className="hero">
          <div className="brand">
            TAAP <span>Gemma</span>
          </div>
          <div className="kicker">
            Conversazione naturale, un passo alla volta e knowledge consultata
            senza scrivere sui sistemi di Lia o Alda.
          </div>

          <div className="avatarBox">
            <GemmaAvatar status={status} />
            <div className="badge">
              {speaking
                ? "Gemma sta parlando"
                : busy
                  ? "Gemma sta ragionando"
                  : "Gemma è pronta"}
            </div>
          </div>
        </aside>

        <section className="chat">
          <header className="chatHead">
            <div>
              <strong>Parla con Gemma</strong>
              <span>
                Preview isolata
                {metrics?.totalMs
                  ? " · " + metrics.totalMs + " ms"
                  : metrics?.retrievalMs
                    ? " · ricerca " + metrics.retrievalMs + " ms"
                    : ""}
              </span>
            </div>

            <div className="headActions">
              {speaking && (
                <button className="textButton" onClick={stopSpeech} type="button">
                  Ferma voce
                </button>
              )}
              <button
                className="textButton"
                onClick={newConversation}
                type="button"
              >
                Nuova chat
              </button>
            </div>
          </header>

          <div className="messages" ref={listRef}>
            {messages.map((message, index) => (
              <div key={index} className={"msg " + message.role}>
                {message.content ||
                  (busy && index === messages.length - 1
                    ? "Sto verificando il contesto…"
                    : "")}
              </div>
            ))}
          </div>

          <form className="composer" onSubmit={submit}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Scrivi la tua richiesta…"
              autoComplete="off"
              aria-label="Messaggio per Gemma"
            />
            <button className="send" disabled={busy || !input.trim()}>
              Invia
            </button>
          </form>

          <div className="note">
            Knowledge condivisa in sola lettura. Nessuna scrittura sui dati di
            Lia o Alda.
          </div>
        </section>
      </section>
    </main>
  );
}

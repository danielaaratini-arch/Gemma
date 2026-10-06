"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import PortalNav from "../components/PortalNav";
import { useGemmaSpeech } from "../components/useGemmaSpeech";

const GemmaAvatar = dynamic(() => import("../components/GemmaAvatar"), {
  ssr: false,
});

const STORAGE_KEY = "gemma-preview-conversation-v2";
const CONVERSATION_KEY = "gemma-preview-conversation-id-v1";

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
  const [conversationId, setConversationId] = useState(null);
  const [ticketOffer, setTicketOffer] = useState(null);
  const [openedTicket, setOpenedTicket] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [metrics, setMetrics] = useState(null);

  const listRef = useRef(null);
  const abortRef = useRef(null);
  const {
    isSpeaking: speaking,
    begin: beginSpeech,
    enqueue: enqueueSpeech,
    stop: stopSpeech,
  } = useGemmaSpeech();

  useEffect(() => {
    setMessages(restoreConversation());
    setConversationId(localStorage.getItem(CONVERSATION_KEY));
    setHydrated(true);
    void fetch("/api/gemma/session", { cache: "no-store" });
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
  }, [messages, busy, ticketOffer, openedTicket]);

  function newConversation() {
    abortRef.current?.abort();
    stopSpeech();
    setBusy(false);
    setMetrics(null);
    setTicketOffer(null);
    setOpenedTicket(null);
    setConversationId(null);
    setMessages([welcome]);

    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CONVERSATION_KEY);
    } catch {}
  }

  async function openTicket() {
    if (!conversationId || ticketBusy) return;

    setTicketBusy(true);
    try {
      const response = await fetch("/api/gemma/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Impossibile aprire la segnalazione.");
      }

      setOpenedTicket(data.ticket || null);
      setTicketOffer(null);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error?.message ||
            "Non sono riuscita ad aprire la segnalazione. Riprova.",
        },
      ]);
    } finally {
      setTicketBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    beginSpeech();
    setTicketOffer(null);
    setOpenedTicket(null);

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
        body: JSON.stringify({
          messages: context,
          conversationId,
        }),
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
          const streamEvent = JSON.parse(line);

          if (streamEvent.type === "metadata") {
            setMetrics((current) => ({
              ...(current || {}),
              ...streamEvent,
            }));

            if (streamEvent.conversationId) {
              setConversationId(streamEvent.conversationId);
              localStorage.setItem(
                CONVERSATION_KEY,
                streamEvent.conversationId,
              );
            }
          }

          if (streamEvent.type === "delta") {
            const delta = String(streamEvent.content || "");
            answer += delta;
            speechBuffer += delta;

            setMessages((current) => {
              const next = [...current];
              next[next.length - 1] = {
                role: "assistant",
                content: answer,
              };
              return next;
            });

            const extracted = extractSpeechSegments(speechBuffer, false);
            speechBuffer = extracted.rest;

            for (const segment of extracted.segments) {
              enqueueSpeech(segment);
            }
          }

          if (streamEvent.type === "done") {
            setMetrics((current) => ({
              ...(current || {}),
              ...streamEvent,
            }));

            if (streamEvent.conversationId) {
              setConversationId(streamEvent.conversationId);
              localStorage.setItem(
                CONVERSATION_KEY,
                streamEvent.conversationId,
              );
            }

            if (streamEvent.ticket?.ticketRecommended) {
              setTicketOffer(streamEvent.ticket);
            }
          }

          if (streamEvent.type === "error") {
            throw new Error(streamEvent.error || "Errore");
          }
        }
      }

      const finalSpeech = extractSpeechSegments(speechBuffer, true);
      for (const segment of finalSpeech.segments) {
        enqueueSpeech(segment);
      }
    } catch (error) {
      if (error?.name === "AbortError") return;

      stopSpeech();
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
            Conversazione naturale, un passo alla volta e riepilogo operativo
            aggiornato durante il dialogo.
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

            <div className="chatHeaderRight">
              <PortalNav />
              <div className="headActions">
                {speaking && (
                  <button
                    className="textButton"
                    onClick={stopSpeech}
                    type="button"
                  >
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

            {ticketOffer && !openedTicket && (
              <div className="ticketOffer">
                <div>
                  <strong>Vuoi aprire una segnalazione?</strong>
                  <span>
                    Il riepilogo raccolto da Gemma verrà passato al reparto{" "}
                    {ticketOffer.department || "competente"}.
                  </span>
                </div>
                <button onClick={openTicket} disabled={ticketBusy}>
                  {ticketBusy ? "Apertura…" : "Apri segnalazione"}
                </button>
              </div>
            )}

            {openedTicket && (
              <div className="ticketOpened">
                <div>
                  <strong>Segnalazione #{openedTicket.number} aperta</strong>
                  <span>
                    Puoi seguirla e rispondere dal tuo spazio cliente.
                  </span>
                </div>
                <Link href="/cliente">Vai all’area cliente</Link>
              </div>
            )}
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
            Knowledge condivisa in sola lettura. I dati operativi Gemma sono
            separati nello schema dedicato <strong>gemma</strong>.
          </div>
        </section>
      </section>
    </main>
  );
}

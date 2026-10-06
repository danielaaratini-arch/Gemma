"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import GemmaHeader from "../components/GemmaHeader";
import GemmaFooter from "../components/GemmaFooter";
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
  const [ticketRequestKey, setTicketRequestKey] = useState(null);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [micSupported, setMicSupported] = useState(false);
  const [micListening, setMicListening] = useState(false);
  const [micError, setMicError] = useState("");

  const listRef = useRef(null);
  const abortRef = useRef(null);
  const recognitionRef = useRef(null);
  const recognitionPrefixRef = useRef("");
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

    void fetch("/api/gemma/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (data?.user?.role === "CUSTOMER" && data.user.email) {
          setNotificationEmail(data.user.email);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition) {
      setMicSupported(false);
      return;
    }

    setMicSupported(true);

    const recognition = new Recognition();
    recognition.lang = "it-IT";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript || "";
      }

      const prefix = recognitionPrefixRef.current;
      const separator =
        prefix && transcript && !/\s$/.test(prefix) ? " " : "";

      setInput((prefix + separator + transcript).trimStart());
      setMicError("");
    };

    recognition.onerror = (event) => {
      setMicListening(false);

      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setMicError("Consenti l’uso del microfono per parlare con Gemma.");
      } else if (event?.error !== "aborted" && event?.error !== "no-speech") {
        setMicError("Non riesco ad ascoltare in questo momento.");
      }
    };

    recognition.onend = () => {
      setMicListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.abort();
      } catch {}
      recognitionRef.current = null;
    };
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
    try {
      recognitionRef.current?.abort();
    } catch {}
    setMicListening(false);
    setMicError("");
    stopSpeech();
    setBusy(false);
    setMetrics(null);
    setTicketOffer(null);
    setOpenedTicket(null);
    setTicketRequestKey(null);
    setNotificationEmail("");
    setConversationId(null);
    setMessages([welcome]);

    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CONVERSATION_KEY);
    } catch {}
  }

  function toggleMicrophone() {
    if (!micSupported || busy) return;

    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (micListening) {
      try {
        recognition.stop();
      } catch {}
      setMicListening(false);
      return;
    }

    recognitionPrefixRef.current = input.trim();
    setMicError("");

    try {
      recognition.start();
      setMicListening(true);
    } catch {
      setMicListening(false);
      setMicError("Il microfono è già in uso. Riprova.");
    }
  }

  async function openTicket() {
    if (!conversationId || ticketBusy) return;

    setTicketBusy(true);
    try {
      const response = await fetch("/api/gemma/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, requestKey: ticketRequestKey, notificationEmail }),
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

    if (micListening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setMicListening(false);
    }

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
              setTicketRequestKey(
                typeof crypto !== "undefined" && crypto.randomUUID
                  ? crypto.randomUUID()
                  : String(Date.now()) + "-" + Math.random().toString(36).slice(2),
              );
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
    <main className="gemmaPublicPage">
      <GemmaHeader />

      <section className="gemmaHeroSection">
        <div className="gemmaHeroContainer">
          <div className="gemmaPresentation">
            <p className="gemmaEyebrow">Tiscali Assistant AI Platform</p>

            <h1 className="gemmaHeroTitle">
              Gemma, il nuovo volto{" "}
              <br />
              dell&apos;assistenza <span>Tiscali.</span>
            </h1>

            <p className="gemmaHeroDescription">
              Un assistente conversazionale che comprende il contesto,
              consulta la knowledge Tiscali e accompagna il cliente fino
              all&apos;eventuale apertura della segnalazione.
            </p>

            <div className="gemmaHeroActions">
              <Link href="/cliente" className="gemmaSecondaryButton">
                Area cliente
              </Link>
            </div>

            <p className="gemmaHeroCredit">
              Progettato per Tiscali con identità Smeraldo.
            </p>
          </div>

          <div className="gemmaAssistantPanel">
            <div className="gemmaPanelHeader">
              <div className="gemmaIdentity">
                <strong>Gemma</strong>
                <span>Assistente virtuale Tiscali</span>
              </div>

              <div className="gemmaStatus">
                <span
                  className={
                    busy
                      ? "gemmaStatusDot gemmaStatusThinking"
                      : "gemmaStatusDot"
                  }
                />
                <span>
                  {busy
                    ? "Gemma sta pensando"
                    : speaking
                      ? "Gemma sta parlando"
                      : "Gemma Online"}
                </span>
              </div>
            </div>

            <div className="gemmaAvatarArea">
              <div className="gemmaAvatarPosition">
                <GemmaAvatar status={status} />
              </div>
            </div>

            <div className="gemmaChatArea">
              <div className="gemmaMessages" ref={listRef}>
                {messages.map((message, index) => (
                  <div key={index} className={"gemmaMessage " + message.role}>
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
                      {ticketOffer.summary ? (
                        <details className="ticketOfferSummary">
                          <summary>Riepilogo della segnalazione</summary>
                          <pre>{ticketOffer.summary}</pre>
                        </details>
                      ) : null}
                    </div>
                    <div className="ticketOfferActions">
                      <input
                        type="email"
                        value={notificationEmail}
                        onChange={(event) => setNotificationEmail(event.target.value)}
                        placeholder="Email per le notifiche"
                        aria-label="Email per le notifiche del ticket"
                      />
                      <button
                        onClick={openTicket}
                        disabled={ticketBusy || !notificationEmail.includes("@")}
                      >
                        {ticketBusy ? "Apertura…" : "Apri segnalazione"}
                      </button>
                    </div>
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

              <div className="gemmaComposerWrap">
                <form className="gemmaComposer" onSubmit={submit}>
                  {micSupported && (
                    <button
                      type="button"
                      className={
                        micListening
                          ? "gemmaMicButton listening"
                          : "gemmaMicButton"
                      }
                      onClick={toggleMicrophone}
                      disabled={busy}
                      aria-label={
                        micListening
                          ? "Ferma ascolto"
                          : "Parla con Gemma"
                      }
                      title={
                        micListening
                          ? "Ferma ascolto"
                          : "Parla con Gemma"
                      }
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <path d="M12 17v5" />
                        <path d="M8 22h8" />
                      </svg>
                    </button>
                  )}

                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={
                      micListening
                        ? "Ti ascolto…"
                        : "Scrivi o parla con Gemma…"
                    }
                    autoComplete="off"
                    aria-label="Messaggio per Gemma"
                  />

                  <button
                    className="gemmaSendButton"
                    disabled={busy || !input.trim()}
                  >
                    Invia
                  </button>
                </form>

                {micError ? (
                  <div className="gemmaMicError">{micError}</div>
                ) : null}

                <div className="gemmaComposerMeta">
                  <div>
                    {metrics?.totalMs
                      ? metrics.totalMs + " ms"
                      : "Preview Gemma"}
                  </div>
                  <div className="gemmaComposerActions">
                    {speaking && (
                      <button type="button" onClick={stopSpeech}>
                        Ferma voce
                      </button>
                    )}
                    <button type="button" onClick={newConversation}>
                      Nuova chat
                    </button>
                    <Link href="/cliente">Area cliente</Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="gemmaQuickLinks">
        <div>
          <strong>Area cliente</strong>
          <span>Consulta ticket e messaggi del backoffice.</span>
          <Link href="/cliente">Apri area cliente</Link>
        </div>
        <div>
          <strong>Backoffice</strong>
          <span>Gestisci code, note, stati e risposte.</span>
          <Link href="/backoffice">Apri backoffice</Link>
        </div>
        <div>
          <strong>Admin</strong>
          <span>Controlla performance, ticket e piattaforma.</span>
          <Link href="/admin">Apri admin</Link>
        </div>
      </section>

      <GemmaFooter />
    </main>
  );
}

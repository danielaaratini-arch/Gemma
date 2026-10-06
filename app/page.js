"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const GemmaAvatar = dynamic(() => import("../components/GemmaAvatar"), {
  ssr: false,
});

const welcome = {
  role: "assistant",
  content:
    "Ciao, sono Gemma. Dimmi pure cosa ti serve: seguirò il contesto senza costringerti in percorsi rigidi.",
};

export default function Home() {
  const [messages, setMessages] = useState([welcome]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  function speak(text) {
    if (!("speechSynthesis" in window) || !text.trim()) return;

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "it-IT";
    utterance.rate = 1.02;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    speechSynthesis.speak(utterance);
  }

  async function submit(event) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    const context = [...messages, { role: "user", content: question }];
    setMessages([...context, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setMetrics(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: context }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Errore");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

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
            answer += String(event.content || "");
            setMessages((current) => {
              const next = [...current];
              next[next.length - 1] = { role: "assistant", content: answer };
              return next;
            });
          }

          if (event.type === "done") {
            setMetrics((current) => ({ ...(current || {}), ...event }));
          }

          if (event.type === "error") {
            throw new Error(event.error || "Errore");
          }
        }
      }

      if (answer.trim()) speak(answer);
    } catch (error) {
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = {
          role: "assistant",
          content:
            "La preview è online, ma il motore conversazionale non dispone ancora di tutte le variabili necessarie per rispondere.",
        };
        return next;
      });
    } finally {
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
            Un unico interprete semantico, retrieval contestuale e nessuna
            classificazione del linguaggio tramite regex.
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
            <strong>Parla con Gemma</strong>
            <span>
              Preview isolata
              {metrics?.totalMs
                ? " · " + metrics.totalMs + " ms"
                : metrics?.retrievalMs
                  ? " · ricerca " + metrics.retrievalMs + " ms"
                  : ""}
            </span>
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

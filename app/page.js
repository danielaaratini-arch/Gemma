"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const GemmaAvatar = dynamic(() => import("../components/GemmaAvatar"), {
  ssr: false,
});

export default function Home() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Ciao, sono Gemma. Dimmi pure cosa ti serve: seguirò il contesto senza costringerti in percorsi rigidi.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
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

    const nextMessages = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Errore");

      const answer = String(data.answer || "");
      setMessages((current) => [
        ...current,
        { role: "assistant", content: answer },
      ]);
      speak(answer);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            "La preview è online, ma il motore conversazionale non dispone ancora di tutte le variabili necessarie per rispondere.",
        },
      ]);
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
            Nuova architettura conversazionale: comprensione del contesto,
            poche regole e knowledge consultata in sola lettura.
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
            <span>Preview sperimentale isolata</span>
          </header>

          <div className="messages" ref={listRef}>
            {messages.map((message, index) => (
              <div key={index} className={"msg " + message.role}>
                {message.content}
              </div>
            ))}
            {busy && (
              <div className="msg assistant pending">
                Sto verificando il contesto…
              </div>
            )}
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
            Questa preview non scrive sulla knowledge condivisa.
          </div>
        </section>
      </section>
    </main>
  );
}

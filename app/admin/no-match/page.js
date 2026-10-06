"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

function NoMatchBody({ user, logout }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/gemma/admin/no-match?limit=500", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "No Match non disponibili.");
      }
      setItems(data.noMatches || []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No Match non disponibili.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [
        item.question,
        item.service,
        item.department,
        ...(item.ticketNumbers || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  const occurrences = items.reduce(
    (sum, item) => sum + Number(item.count || 0),
    0,
  );

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout} />

      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">Copertura Knowledge</p>
            <h1>No Match</h1>
            <p>
              Per Gemma un No Match è esattamente un turno con{" "}
              <strong>knowledgeHits = 0</strong>: nessuna fonte Knowledge
              recuperata.
            </p>
          </div>

          <button className="internalRefresh" onClick={() => void load()}>
            Aggiorna
          </button>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <section className="statGrid">
          <article className="statCard">
            <span>Richieste distinte</span>
            <strong>{items.length}</strong>
          </article>
          <article className="statCard">
            <span>Occorrenze</span>
            <strong>{occurrences}</strong>
          </article>
        </section>

        <section className="adminPanel">
          <div className="noMatchToolbar">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca domanda, servizio, reparto o ticket…"
            />
            <Link href="/admin/knowledge" className="internalPrimaryLink">
              Aggiorna Knowledge
            </Link>
          </div>
        </section>

        <section className="adminPanel recentPanel">
          <div className="panelTitle">
            Richieste senza fonte · {filtered.length}
          </div>

          <div className="noMatchList">
            {filtered.map((item) => (
              <article className="noMatchCard" key={item.key}>
                <div className="noMatchCardTop">
                  <div>
                    <strong>{item.question}</strong>
                    <small>
                      {item.service || "Servizio non definito"} ·{" "}
                      {item.department || "Reparto non definito"}
                    </small>
                  </div>
                  <span className="noMatchCount">{item.count}×</span>
                </div>

                <div className="noMatchMeta">
                  <span>
                    Ultima occorrenza:{" "}
                    {new Date(item.lastSeen).toLocaleString("it-IT")}
                  </span>
                  {item.ticketNumbers?.length ? (
                    <span>
                      Ticket:{" "}
                      {item.ticketNumbers
                        .map((number) => "#" + String(number).padStart(6, "0"))
                        .join(", ")}
                    </span>
                  ) : null}
                </div>

                <div className="internalRowActions">
                  <Link
                    className="internalActionLink"
                    href={
                      "/admin/knowledge?noMatch=" +
                      encodeURIComponent(item.question)
                    }
                  >
                    Integra Knowledge
                  </Link>

                  {item.examples?.[0]?.conversationId ? (
                    <Link
                      className="internalActionLink secondary"
                      href={
                        "/conversations?conversationId=" +
                        encodeURIComponent(item.examples[0].conversationId)
                      }
                    >
                      Vedi conversazione
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}

            {!filtered.length ? (
              <div className="emptyState">
                Nessun No Match nel periodo disponibile.
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function NoMatchPage() {
  return (
    <GemmaInternalAuth requiredRole="ADMIN">
      {({ user, logout }) => (
        <NoMatchBody user={user} logout={logout} />
      )}
    </GemmaInternalAuth>
  );
}

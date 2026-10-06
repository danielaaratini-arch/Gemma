"use client";

import { useEffect, useMemo, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

function KnowledgeBody({ user, logout }) {
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const params = new URLSearchParams({
        search,
        status,
        limit: "300",
      });
      const response = await fetch(
        "/api/gemma/admin/knowledge?" + params.toString(),
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Knowledge non disponibile.");
      setDocuments(data.documents || []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Knowledge non disponibile.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(
    () => ({
      total: documents.length,
      active: documents.filter((item) => item.status === "ACTIVE").length,
      draft: documents.filter((item) => item.status === "DRAFT").length,
      archived: documents.filter((item) => item.status === "ARCHIVED").length,
      chunks: documents.reduce((sum, item) => sum + Number(item.chunks || 0), 0),
    }),
    [documents],
  );

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout} />
      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">Knowledge condivisa</p>
            <h1>Knowledge Base</h1>
            <p>
              Gemma la usa in sola lettura. Questa vista consente controllo, ricerca e verifica della copertura senza modificare i documenti di Lia/Alda.
            </p>
          </div>
          <button className="internalRefresh" onClick={() => void load()}>
            Aggiorna
          </button>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <section className="statGrid">
          <article className="statCard"><span>Documenti</span><strong>{counts.total}</strong></article>
          <article className="statCard"><span>Attivi</span><strong>{counts.active}</strong></article>
          <article className="statCard"><span>Archiviati</span><strong>{counts.archived}</strong></article>
          <article className="statCard"><span>Chunk</span><strong>{counts.chunks}</strong></article>
        </section>

        <section className="adminPanel">
          <div className="knowledgeToolbar">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cerca titolo, descrizione o argomento…"
            />
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ALL">Tutti gli stati</option>
              <option value="ACTIVE">Attivi</option>
              <option value="DRAFT">Bozze</option>
              <option value="ARCHIVED">Archiviati</option>
            </select>
            <button onClick={() => void load()}>Cerca</button>
          </div>
        </section>

        <section className="adminPanel recentPanel">
          <div className="panelTitle">Documenti</div>
          <div className="knowledgeTable">
            <div className="knowledgeTableHead">
              <span>Titolo</span>
              <span>Servizio</span>
              <span>Area</span>
              <span>Stato</span>
              <span>Chunk</span>
            </div>
            {documents.map((item) => (
              <div className="knowledgeTableRow" key={item.id}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.topic || item.category || "—"}</small>
                </span>
                <span>{item.service_type || "—"}</span>
                <span>{item.assistance_area || "—"}</span>
                <span className="statusPill">{item.status}</span>
                <span>{item.chunks}</span>
              </div>
            ))}
            {documents.length === 0 ? (
              <div className="emptyState">Nessun documento trovato.</div>
            ) : null}
          </div>
        </section>

        <div className="knowledgeReadOnlyNotice">
          Gestione massiva, preview/apply/rollback e modifica documenti restano sul sistema proprietario della Knowledge. Gemma non introduce una seconda copia né scrive sul corpus condiviso.
        </div>
      </section>
    </main>
  );
}

export default function AdminKnowledgePage() {
  return (
    <GemmaInternalAuth requiredRole="ADMIN">
      {({ user, logout }) => (
        <KnowledgeBody user={user} logout={logout} />
      )}
    </GemmaInternalAuth>
  );
}

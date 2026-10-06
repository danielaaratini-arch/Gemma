"use client";

import { useEffect, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

function Body({ user, logout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/gemma/admin/ai-router", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || "Metriche non disponibili.");
    setData(payload);
  }

  useEffect(()=>{void load().catch((e)=>setError(e instanceof Error?e.message:"Errore"));},[]);

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout} />
      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">AI observability</p>
            <h1>AI Router</h1>
            <p>Gemma non usa un router a regole: qui vedi chiamate, modello, retrieval e latenza reali.</p>
          </div>
          <button className="internalRefresh" onClick={()=>void load()}>Aggiorna</button>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <section className="statGrid">
          <article className="statCard"><span>Chiamate</span><strong>{data?.summary?.calls ?? "—"}</strong></article>
          <article className="statCard"><span>Tempo medio</span><strong>{data?.summary?.average_duration ? data.summary.average_duration+" ms":"—"}</strong></article>
          <article className="statCard"><span>Retrieval medio</span><strong>{data?.summary?.average_retrieval ? data.summary.average_retrieval+" ms":"—"}</strong></article>
          <article className="statCard"><span>Senza fonti</span><strong>{data?.summary?.no_source_calls ?? "—"}</strong></article>
        </section>

        <section className="adminPanel">
          <div className="panelTitle">Ultime chiamate</div>
          <div className="adminTable aiTable">
            <div className="adminTableHead"><span>Ora</span><span>Modello</span><span>Totale</span><span>Retrieval</span><span>Fonti</span></div>
            {(data?.recent || []).map((item)=>(
              <div className="adminTableRow" key={item.id}>
                <span>{new Date(item.createdAt).toLocaleString("it-IT")}</span>
                <span>{item.model || "—"}</span>
                <span>{item.totalMs} ms</span>
                <span>{item.retrievalMs} ms</span>
                <span>{item.knowledgeHits}</span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function AIRouterPage() {
  return <GemmaInternalAuth requiredRole="ADMIN">{({user,logout})=><Body user={user} logout={logout}/>}</GemmaInternalAuth>;
}

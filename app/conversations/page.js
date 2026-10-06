"use client";

import { useEffect, useState } from "react";
import GemmaInternalAuth from "../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../components/GemmaInternalNav";

function ConversationsBody({ user, logout }) {
  const [items,setItems]=useState([]);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");

  async function load() {
    setError("");
    try {
      const response=await fetch(
        "/api/gemma/conversations?limit=150&search="+encodeURIComponent(search),
        {cache:"no-store"},
      );
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error||"Conversazioni non disponibili.");
      const rows=data.conversations||[];
      setItems(rows);
      setSelected(current=>rows.find(item=>item.id===current?.id)||rows[0]||null);
    } catch(caught) {
      setError(caught instanceof Error?caught.message:"Conversazioni non disponibili.");
    }
  }

  useEffect(()=>{void load();},[]);

  return (
    <main className="internalPage">
      <GemmaInternalNav role={user.role} user={user} onLogout={logout}/>
      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">Cronologia</p>
            <h1>Conversazioni Gemma</h1>
            <p>Consultazione completa dei dialoghi persistiti e del relativo stato semantico.</p>
          </div>
          <button className="internalRefresh" onClick={()=>void load()}>Aggiorna</button>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <section className="conversationSearchBar">
          <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Cerca per titolo o customer key…" />
          <button onClick={()=>void load()}>Cerca</button>
        </section>

        <div className="conversationAdminGrid">
          <aside className="conversationAdminList">
            {items.map(item=>(
              <button key={item.id} className={selected?.id===item.id?"active":""} onClick={()=>setSelected(item)}>
                <strong>{item.title||"Conversazione"}</strong>
                <span>{item.customer_key}</span>
                <small>{new Date(item.updated_at).toLocaleString("it-IT")}</small>
              </button>
            ))}
            {items.length===0 ? <div className="emptyState">Nessuna conversazione.</div>:null}
          </aside>

          <section className="conversationAdminDetail">
            {!selected ? <div className="emptyState">Seleziona una conversazione.</div> : (
              <>
                <div className="detailHeader">
                  <div><span className="eyebrow">{selected.status}</span><h2>{selected.title||"Conversazione"}</h2><small>{selected.customer_key}</small></div>
                </div>
                <div className="conversationStateCard">
                  <strong>Stato del caso</strong>
                  <pre>{JSON.stringify(selected.state_json||{},null,2)}</pre>
                </div>
                <div className="ticketMessages conversationArchiveMessages">
                  {(selected.messages||[]).map(message=>(
                    <div key={message.id} className={"ticketBubble "+(message.role==="USER"?"customer":"gemma")}>
                      <div className="ticketBubbleMeta">{message.role==="USER"?"Cliente":"Gemma"} · {new Date(message.created_at).toLocaleString("it-IT")}</div>
                      <div>{message.content}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default function ConversationsPage(){
  return <GemmaInternalAuth requiredRole="STAFF">{({user,logout})=><ConversationsBody user={user} logout={logout}/>}</GemmaInternalAuth>;
}

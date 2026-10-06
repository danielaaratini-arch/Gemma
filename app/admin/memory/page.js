"use client";

import { useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

function MemoryBody({ user, logout }) {
  const [customerKey, setCustomerKey] = useState("");
  const [items, setItems] = useState([]);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const response = await fetch(
      "/api/gemma/admin/memory?customerKey=" +
        encodeURIComponent(customerKey.trim()),
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Memorie non disponibili.");
    setItems(data.memories || []);
  }

  async function add() {
    if (!customerKey.trim() || !value.trim()) return;
    try {
      const response = await fetch("/api/gemma/admin/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerKey: customerKey.trim(),
          value: value.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Memoria non salvata.");
      setValue("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Memoria non salvata.");
    }
  }

  async function saveEdit(id) {
    const response = await fetch("/api/gemma/admin/memory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, value: editValue }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Modifica non riuscita.");
    setEditing(null);
    setEditValue("");
    await load();
  }

  async function remove(id) {
    if (!window.confirm("Eliminare questa memoria?")) return;
    await fetch("/api/gemma/admin/memory", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout} />
      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">Contesto cliente</p>
            <h1>Customer Memory</h1>
            <p>
              Memorie esplicite collegate al customer key. Gemma le usa solo quando sono pertinenti al turno corrente.
            </p>
          </div>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <section className="adminPanel">
          <div className="memorySearch">
            <input
              value={customerKey}
              onChange={(e)=>setCustomerKey(e.target.value)}
              placeholder="Customer key"
            />
            <button onClick={()=>void load()} disabled={!customerKey.trim()}>Carica memoria</button>
          </div>
        </section>

        {customerKey.trim() ? (
          <div className="adminColumns">
            <section className="adminPanel">
              <div className="panelTitle">Aggiungi memoria</div>
              <textarea
                className="memoryTextarea"
                value={value}
                onChange={(e)=>setValue(e.target.value)}
                rows={6}
                placeholder="Informazione utile e stabile sul cliente…"
              />
              <button className="internalPrimaryButton" onClick={()=>void add()} disabled={!value.trim()}>
                Salva memoria
              </button>
            </section>

            <section className="adminPanel">
              <div className="panelTitle">Memorie salvate</div>
              <div className="memoryList">
                {items.map((item)=>(
                  <article className="memoryItem" key={item.id}>
                    {editing === item.id ? (
                      <>
                        <textarea value={editValue} onChange={(e)=>setEditValue(e.target.value)} rows={4} />
                        <div className="internalRowActions">
                          <button onClick={()=>void saveEdit(item.id)}>Salva</button>
                          <button className="secondary" onClick={()=>setEditing(null)}>Annulla</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p>{item.value}</p>
                        <small>
                          {item.source || "ADMIN"} · {new Date(item.updated_at).toLocaleString("it-IT")}
                        </small>
                        <div className="internalRowActions">
                          <button onClick={()=>{setEditing(item.id);setEditValue(item.value);}}>Modifica</button>
                          <button className="danger" onClick={()=>void remove(item.id)}>Elimina</button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
                {items.length === 0 ? <div className="emptyState">Nessuna memoria salvata per questo cliente.</div> : null}
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default function AdminMemoryPage() {
  return (
    <GemmaInternalAuth requiredRole="ADMIN">
      {({ user, logout }) => <MemoryBody user={user} logout={logout} />}
    </GemmaInternalAuth>
  );
}

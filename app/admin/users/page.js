"use client";

import { useEffect, useMemo, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

const EMPTY = {
  name: "",
  email: "",
  password: "",
  role: "OPERATOR",
};

function UsersBody({ user, logout }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    const response = await fetch("/api/gemma/admin/users", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Accessi non disponibili.");
    setUsers(data.users || []);
  }

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Errore caricamento."),
    );
  }, []);

  const counts = useMemo(
    () => ({
      operators: users.filter((item) => item.role === "OPERATOR").length,
      admins: users.filter((item) => item.role === "ADMIN").length,
      active: users.filter((item) => item.active).length,
    }),
    [users],
  );

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/gemma/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Creazione non riuscita.");
      setForm(EMPTY);
      setSuccess("Accesso creato.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id, patch) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/gemma/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Aggiornamento non riuscito.");
      setEditing(null);
      setSuccess("Accesso aggiornato.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aggiornamento non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Eliminare definitivamente questo accesso?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/gemma/admin/users", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Eliminazione non riuscita.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Eliminazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout} />
      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">Amministrazione</p>
            <h1>Gestione accessi</h1>
            <p>Operatori backoffice e amministratori Gemma.</p>
          </div>
        </div>

        <section className="statGrid">
          <article className="statCard"><span>Operatori</span><strong>{counts.operators}</strong></article>
          <article className="statCard"><span>Amministratori</span><strong>{counts.admins}</strong></article>
          <article className="statCard"><span>Account attivi</span><strong>{counts.active}</strong></article>
        </section>

        {success ? <div className="internalSuccess">{success}</div> : null}
        {error ? <div className="internalError">{error}</div> : null}

        <div className="adminColumns">
          <section className="adminPanel">
            <div className="panelTitle">Nuovo accesso</div>
            <form className="internalForm" onSubmit={create}>
              <label>Nome<input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required /></label>
              <label>Email<input type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} required /></label>
              <label>Password iniziale<input type="password" minLength={8} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} required /></label>
              <label>Ruolo<select value={form.role} onChange={(e)=>setForm({...form,role:e.target.value})}><option value="OPERATOR">Operatore</option><option value="ADMIN">Amministratore</option></select></label>
              <button disabled={busy}>Crea accesso</button>
            </form>
          </section>

          <section className="adminPanel">
            <div className="panelTitle">Utenti interni</div>
            <div className="internalUserList">
              {users.map((item) => (
                <div className="internalUserRow" key={item.id}>
                  {editing === item.id ? (
                    <div className="internalEditGrid">
                      <input value={edit.name ?? item.name} onChange={(e)=>setEdit({...edit,name:e.target.value})} />
                      <input type="email" value={edit.email ?? item.email} onChange={(e)=>setEdit({...edit,email:e.target.value})} />
                      <select value={edit.role ?? item.role} onChange={(e)=>setEdit({...edit,role:e.target.value})}>
                        <option value="OPERATOR">Operatore</option>
                        <option value="ADMIN">Amministratore</option>
                      </select>
                      <input type="password" placeholder="Nuova password (opzionale)" onChange={(e)=>setEdit({...edit,password:e.target.value})} />
                      <div className="internalRowActions">
                        <button onClick={()=>void patch(item.id, edit)}>Salva</button>
                        <button className="secondary" onClick={()=>{setEditing(null);setEdit({});}}>Annulla</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <strong>{item.name}</strong>
                        <span>{item.email}</span>
                        <small>{item.role} · {item.active ? "Attivo" : "Disattivato"}</small>
                      </div>
                      <div className="internalRowActions">
                        <button onClick={()=>{setEditing(item.id);setEdit({name:item.name,email:item.email,role:item.role});}}>Modifica</button>
                        <button className="secondary" onClick={()=>void patch(item.id,{active:!item.active})}>{item.active ? "Disattiva" : "Riattiva"}</button>
                        <button className="danger" onClick={()=>void remove(item.id)}>Elimina</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {users.length === 0 ? <div className="emptyState">Nessun accesso configurato.</div> : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default function AdminUsersPage() {
  return (
    <GemmaInternalAuth requiredRole="ADMIN">
      {({ user, logout }) => <UsersBody user={user} logout={logout} />}
    </GemmaInternalAuth>
  );
}

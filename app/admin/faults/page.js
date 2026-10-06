"use client";

import { useEffect, useMemo, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

const TYPE_OPTIONS = {
  MOBILE: [
    ["MOBILE_ACTIVATION_DELAY", "Ritardo attivazione"],
    ["MOBILE_DATA", "Dati mobili"],
    ["MOBILE_VOICE", "Voce"],
    ["MOBILE_RECHARGE", "Ricarica"],
    ["MOBILE_RENEWAL", "Rinnovo offerte"],
  ],
  EMAIL: [["EMAIL_GENERAL", "Malfunzionamento email"]],
  FIXED: [
    ["FIXED_GENERAL", "Fault rete fissa generalizzato"],
    ["FIXED_LOCAL", "Fault rete fissa localizzato"],
  ],
};

const TEMPLATES = {
  MOBILE_ACTIVATION_DELAY: "È presente un disservizio noto sulle attivazioni Mobile. La lavorazione è in corso.",
  MOBILE_DATA: "È presente un disservizio noto sulla connettività dati Mobile. I tecnici stanno intervenendo.",
  MOBILE_VOICE: "È presente un disservizio noto sul servizio voce Mobile. I tecnici stanno intervenendo.",
  MOBILE_RECHARGE: "È presente un disservizio noto sulle ricariche Mobile.",
  MOBILE_RENEWAL: "È presente un disservizio noto sui rinnovi delle offerte Mobile.",
  EMAIL_GENERAL: "È presente un disservizio noto sul servizio email.",
  FIXED_GENERAL: "È presente un disservizio noto sulla rete fissa.",
  FIXED_LOCAL: "È presente un disservizio noto sulla rete fissa nella zona indicata.",
};

function blank() {
  return {
    id: "",
    service: "MOBILE",
    faultType: "MOBILE_DATA",
    city: "",
    matchDescription: "Problemi di connessione dati mobile coerenti con il disservizio attivo.",
    message: TEMPLATES.MOBILE_DATA,
    active: true,
  };
}

function FaultsBody({ user, logout }) {
  const [faults, setFaults] = useState([]);
  const [form, setForm] = useState(blank());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/gemma/admin/faults", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Alert non disponibili.");
    setFaults(data.faults || []);
  }

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Errore caricamento."),
    );
  }, []);

  const activeCount = useMemo(
    () => faults.filter((item) => item.active).length,
    [faults],
  );

  function selectService(service) {
    const first = TYPE_OPTIONS[service][0][0];
    setForm({
      ...form,
      service,
      faultType: first,
      city: "",
      message: TEMPLATES[first],
    });
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/gemma/admin/faults", {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Salvataggio non riuscito.");
      setForm(blank());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Salvataggio non riuscito.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Eliminare questo alert?")) return;
    await fetch("/api/gemma/admin/faults", {
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
            <p className="internalEyebrow">Contesto operativo</p>
            <h1>Alert fault</h1>
            <p>
              Gemma riceve gli alert attivi come contesto strutturato; decide semanticamente se sono pertinenti, senza matching a parole.
            </p>
          </div>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <div className="adminColumns">
          <section className="adminPanel">
            <div className="panelTitle">{form.id ? "Modifica alert" : "Nuovo alert"}</div>
            <form className="internalForm" onSubmit={save}>
              <label>
                Servizio
                <select value={form.service} onChange={(e)=>selectService(e.target.value)}>
                  <option value="MOBILE">Mobile</option>
                  <option value="EMAIL">Email</option>
                  <option value="FIXED">Rete fissa</option>
                </select>
              </label>

              <label>
                Tipologia
                <select
                  value={form.faultType}
                  onChange={(e)=>{
                    const faultType=e.target.value;
                    setForm({...form,faultType,message:TEMPLATES[faultType] || form.message});
                  }}
                >
                  {TYPE_OPTIONS[form.service].map(([value,label])=>(
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              {form.faultType === "FIXED_LOCAL" ? (
                <label>Città<input value={form.city} onChange={(e)=>setForm({...form,city:e.target.value})} required /></label>
              ) : null}

              <label>
                Descrizione semantica di pertinenza
                <textarea
                  value={form.matchDescription}
                  onChange={(e)=>setForm({...form,matchDescription:e.target.value})}
                  rows={3}
                  required
                />
              </label>

              <label>
                Messaggio al cliente
                <textarea
                  value={form.message}
                  onChange={(e)=>setForm({...form,message:e.target.value})}
                  rows={4}
                  required
                />
              </label>

              <label className="internalCheckbox">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e)=>setForm({...form,active:e.target.checked})}
                />
                Alert attivo
              </label>

              <div className="internalRowActions">
                <button disabled={busy}>{busy ? "Salvataggio…" : "Salva alert"}</button>
                {form.id ? <button type="button" className="secondary" onClick={()=>setForm(blank())}>Annulla</button> : null}
              </div>
            </form>
          </section>

          <section className="adminPanel">
            <div className="panelTitle">Alert configurati · {activeCount} attivi su {faults.length}</div>
            <div className="faultList">
              {faults.map((item)=>(
                <article className="faultCard" key={item.id}>
                  <div className="faultCardTop">
                    <strong>{item.fault_type}{item.city ? " · " + item.city : ""}</strong>
                    <span className={item.active ? "statusPill active" : "statusPill"}>{item.active ? "Attivo" : "Disattivato"}</span>
                  </div>
                  <small>{item.service}</small>
                  <p><b>Pertinenza:</b> {item.match_description}</p>
                  <p>{item.message}</p>
                  <div className="internalRowActions">
                    <button onClick={()=>setForm({
                      id:item.id,
                      service:item.service,
                      faultType:item.fault_type,
                      city:item.city || "",
                      matchDescription:item.match_description,
                      message:item.message,
                      active:item.active,
                    })}>Modifica</button>
                    <button className="secondary" onClick={()=>void fetch("/api/gemma/admin/faults",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({
                      id:item.id,
                      service:item.service,
                      faultType:item.fault_type,
                      city:item.city,
                      matchDescription:item.match_description,
                      message:item.message,
                      active:!item.active,
                    })}).then(()=>load())}>{item.active ? "Disattiva" : "Attiva"}</button>
                    <button className="danger" onClick={()=>void remove(item.id)}>Elimina</button>
                  </div>
                </article>
              ))}
              {faults.length === 0 ? <div className="emptyState">Nessun alert configurato.</div> : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default function AdminFaultsPage() {
  return (
    <GemmaInternalAuth requiredRole="ADMIN">
      {({ user, logout }) => <FaultsBody user={user} logout={logout} />}
    </GemmaInternalAuth>
  );
}

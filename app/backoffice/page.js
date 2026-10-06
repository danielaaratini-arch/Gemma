"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GemmaInternalAuth from "../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../components/GemmaInternalNav";
import TicketSummary from "../../components/TicketSummary";

const STATUSES = [
  "OPEN",
  "TAKEN_IN_CHARGE",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_DEPARTMENT",
  "RESOLVED",
  "CLOSED",
];
const REPLY_STATUSES = [
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_DEPARTMENT",
  "RESOLVED",
];
const STATUS_LABELS = {
  OPEN: "Aperto",
  TAKEN_IN_CHARGE: "Preso in carico",
  IN_PROGRESS: "In lavorazione",
  WAITING_CUSTOMER: "In attesa del cliente",
  WAITING_DEPARTMENT: "In attesa del reparto",
  RESOLVED: "Risolto",
  CLOSED: "Chiuso",
};

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const PRIORITY_LABELS = {
  LOW: "Bassa",
  MEDIUM: "Media",
  HIGH: "Alta",
};

const DEPARTMENTS = [
  "MOBILE_TECHNICAL",
  "FIXED_TECHNICAL",
  "ADMINISTRATIVE",
  "COMMERCIAL",
  "VENDITE",
  "EMAIL",
  "PEC",
  "BILLING",
  "OTHER",
];

const DEPARTMENT_LABELS = {
  MOBILE_TECHNICAL: "Tecnico Mobile",
  FIXED_TECHNICAL: "Tecnico Fisso",
  ADMINISTRATIVE: "Amministrativo",
  COMMERCIAL: "Commerciale",
  VENDITE: "Vendite",
  EMAIL: "Email",
  PEC: "PEC",
  BILLING: "Fatturazione",
  OTHER: "Altro",
};

function statusLabel(value) {
  return STATUS_LABELS[value] || value || "—";
}

function priorityLabel(value) {
  return PRIORITY_LABELS[value] || value || "—";
}

function departmentLabel(value) {
  return DEPARTMENT_LABELS[value] || value || "—";
}

function when(value) {
  return value
    ? new Intl.DateTimeFormat("it-IT", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "";
}

function BackofficeBody({ user, logout }) {
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [department, setDepartment] = useState("ALL");
  const [mineOnly, setMineOnly] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [replyStatus, setReplyStatus] = useState("IN_PROGRESS");
  const [note, setNote] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const fileInputRef = useRef(null);

  async function loadTickets({ append = false, cursor = null } = {}) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        scope: "all",
        limit: "30",
        search,
        status,
        department,
        mine: mineOnly ? "1" : "0",
      });
      if (cursor) params.set("cursor", cursor);

      const response = await fetch("/api/gemma/tickets?" + params.toString(), {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Ticket non disponibili.");

      const rows = Array.isArray(data.tickets) ? data.tickets : [];
      setTickets((current) => (append ? [...current, ...rows] : rows));
      setNextCursor(data.nextCursor || null);

      if (!append) {
        setSelectedId((current) =>
          current && rows.some((item) => item.id === current)
            ? current
            : rows[0]?.id || null,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Errore caricamento.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) {
      setDetail(null);
      return;
    }

    try {
      const response = await fetch(
        "/api/gemma/tickets/" + id + "?scope=staff",
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Ticket non disponibile.");
      setDetail(data.ticket || null);

      void fetch("/api/gemma/tickets/" + id + "/view", {
        method: "POST",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ticket non disponibile.");
    }
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTickets();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, status, department, mineOnly]);

  useEffect(() => {
    void loadDetail(selectedId);
    setReply("");
    setNote("");
    setPendingFiles([]);
  }, [selectedId]);

  async function patchTicket(changes) {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/gemma/tickets/" + selectedId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Aggiornamento non riuscito.");
      await Promise.all([loadDetail(selectedId), loadTickets()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aggiornamento non riuscito.");
    } finally {
      setSaving(false);
    }
  }

  async function takeOwnership() {
    await patchTicket({
      assignee: user.name || user.email,
      status: "TAKEN_IN_CHARGE",
    });
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!selectedId || !note.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(
        "/api/gemma/tickets/" + selectedId + "/notes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: note.trim() }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Nota non salvata.");
      setNote("");
      await loadDetail(selectedId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nota non salvata.");
    } finally {
      setSaving(false);
    }
  }

  function chooseFiles(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    const next = [...pendingFiles, ...selected].slice(0, 5);
    const total = next.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (next.some((file) => file.size > 5 * 1024 * 1024)) {
      setError("Ogni file può avere una dimensione massima di 5 MB.");
      return;
    }
    if (total > 10 * 1024 * 1024) {
      setError("Gli allegati selezionati superano 10 MB.");
      return;
    }
    setPendingFiles(next);
  }

  async function sendReply(event) {
    event.preventDefault();
    const text = reply.trim();
    if (!selectedId || saving || (!text && pendingFiles.length === 0)) return;

    setSaving(true);
    setError("");
    try {
      if (pendingFiles.length) {
        const form = new FormData();
        pendingFiles.forEach((file) => form.append("files", file));
        const upload = await fetch(
          "/api/gemma/tickets/" + selectedId + "/attachments?scope=staff",
          { method: "POST", body: form },
        );
        const payload = await upload.json().catch(() => ({}));
        if (!upload.ok) throw new Error(payload?.error || "Allegati non inviati.");
      }

      const messageText =
        text ||
        (pendingFiles.length === 1
          ? "Allegato inviato: " + pendingFiles[0].name
          : pendingFiles.length + " allegati inviati");

      const response = await fetch(
        "/api/gemma/tickets/" + selectedId + "/messages",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role: "OPERATOR",
            content: messageText,
            status: replyStatus,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Risposta non inviata.");

      setReply("");
      setPendingFiles([]);
      await Promise.all([loadDetail(selectedId), loadTickets()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Risposta non inviata.");
    } finally {
      setSaving(false);
    }
  }

  const conversation = useMemo(() => {
    if (!detail) return [];
    return [
      ...(detail.conversationMessages || []).map((item) => ({
        ...item,
        kind: "message",
      })),
      ...(detail.ticketMessages || []).map((item) => ({
        ...item,
        kind: "message",
      })),
      ...(detail.attachments || []).map((item) => ({
        ...item,
        id: "file-" + item.id,
        role: item.uploaded_by === "Cliente" ? "CUSTOMER" : "OPERATOR",
        created_at: item.created_at,
        kind: "attachment",
      })),
    ].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [detail]);

  return (
    <main className="internalPage backofficePage">
      <GemmaInternalNav role={user.role} user={user} onLogout={logout} />

      <section className="internalContent backofficeContent">
        <div className="backofficeToolbar">
          <input
            className="backofficeSearch"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca ticket, cliente, email, richiesta…"
          />

          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ACTIVE">Attivi</option>
            <option value="ALL">Tutti</option>
            {STATUSES.map((value) => (
              <option value={value} key={value}>{statusLabel(value)}</option>
            ))}
          </select>

          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="ALL">Tutti i reparti</option>
            <option value="UNASSIGNED">Non assegnati</option>
            {DEPARTMENTS.map((value) => (
              <option value={value} key={value}>{departmentLabel(value)}</option>
            ))}
          </select>

          <label className="backofficeMine">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(event) => setMineOnly(event.target.checked)}
            />
            Solo i miei
          </label>

          <button onClick={() => void loadTickets()} disabled={loading}>
            Aggiorna
          </button>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <div className="backofficeWorkspace">
          <aside className="backofficeQueue">
            <div className="panelTitle">Ticket · {tickets.length}</div>
            <div className="backofficeQueueScroll">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  className={
                    selectedId === ticket.id
                      ? "backofficeTicketCard active"
                      : "backofficeTicketCard"
                  }
                  onClick={() => setSelectedId(ticket.id)}
                >
                  <div className="ticketRowTop">
                    <strong>#{String(ticket.number).padStart(6, "0")}</strong>
                    <span className="statusPill">{statusLabel(ticket.status)}</span>
                  </div>
                  <p>{ticket.state_json?.issue || ticket.title || "Segnalazione"}</p>
                  <small>
                    {ticket.customer_name || "Cliente"} · {departmentLabel(ticket.department || "OTHER")}
                  </small>
                  <small>{when(ticket.updated_at)}</small>
                </button>
              ))}
              {!loading && tickets.length === 0 ? (
                <div className="emptyState">Nessun ticket trovato.</div>
              ) : null}
            </div>
            {nextCursor ? (
              <button
                className="loadMore"
                onClick={() =>
                  void loadTickets({ append: true, cursor: nextCursor })
                }
              >
                Carica altri
              </button>
            ) : null}
          </aside>

          <section className="backofficeConversation">
            {!detail ? (
              <div className="emptyState">Seleziona un ticket.</div>
            ) : (
              <>
                <div className="detailHeader">
                  <div>
                    <span className="eyebrow">
                      Ticket #{String(detail.number).padStart(6, "0")}
                    </span>
                    <h2>{detail.state_json?.issue || "Segnalazione"}</h2>
                    <small>{detail.customer_name}</small>
                  </div>
                  <span className="statusPill">{statusLabel(detail.status)}</span>
                </div>

                <TicketSummary ticket={detail} />

                <div className="ticketMessages backofficeMessageList">
                  {conversation.map((item) => {
                    if (item.kind === "attachment") {
                      const customer = item.role === "CUSTOMER";
                      return (
                        <div
                          key={item.id}
                          className={
                            "ticketBubble " + (customer ? "customer" : "operator")
                          }
                        >
                          <div className="ticketBubbleMeta">
                            {item.uploaded_by} · {when(item.created_at)}
                          </div>
                          <a
                            className="chatAttachmentBubble"
                            href={item.url + "?scope=staff"}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span className="chatAttachmentIcon">📎</span>
                            <span className="chatAttachmentInfo">
                              <strong>{item.original_name}</strong>
                              <small>
                                {Math.max(1, Math.round(Number(item.size_bytes || 0) / 1024))} KB
                              </small>
                            </span>
                          </a>
                        </div>
                      );
                    }

                    const customer =
                      item.role === "USER" || item.role === "CUSTOMER";
                    const gemma = item.role === "GEMMA";
                    return (
                      <div
                        key={item.id}
                        className={
                          "ticketBubble " +
                          (customer ? "customer" : gemma ? "gemma" : "operator")
                        }
                      >
                        <div className="ticketBubbleMeta">
                          {customer
                            ? "Cliente"
                            : gemma
                              ? "Gemma"
                              : item.author_name || "Backoffice"}{" "}
                          · {when(item.created_at)}
                        </div>
                        <div>{item.content}</div>
                      </div>
                    );
                  })}
                </div>

                <form className="ticketChatComposer" onSubmit={sendReply}>
                  {pendingFiles.length ? (
                    <div className="ticketComposerFiles">
                      {pendingFiles.map((file, index) => (
                        <div className="ticketComposerFileChip" key={file.name + index}>
                          <span>📎</span>
                          <span className="ticketComposerFileInfo">
                            <strong>{file.name}</strong>
                            <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                          </span>
                          <button
                            type="button"
                            className="ticketComposerFileRemove"
                            onClick={() =>
                              setPendingFiles((current) =>
                                current.filter((_, i) => i !== index),
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="ticketComposerRow">
                    <button
                      type="button"
                      className="ticketAttachButton"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      📎
                    </button>
                    <input
                      ref={fileInputRef}
                      className="ticketFileInput"
                      type="file"
                      multiple
                      onChange={chooseFiles}
                    />
                    <input
                      className="ticketComposerText"
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      placeholder="Rispondi al cliente…"
                    />
                    <select
                      className="replyStatusSelect"
                      value={replyStatus}
                      onChange={(event) => setReplyStatus(event.target.value)}
                    >
                      {REPLY_STATUSES.map((value) => (
                        <option value={value} key={value}>{statusLabel(value)}</option>
                      ))}
                    </select>
                    <button
                      className="ticketSendButton"
                      disabled={saving || (!reply.trim() && pendingFiles.length === 0)}
                    >
                      Invia
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>

          <aside className="backofficeMeta">
            {detail ? (
              <>
                <section className="adminPanel compactPanel">
                  <div className="panelTitle">Cliente</div>
                  <div className="metaRows">
                    <div><span>Nome</span><strong>{detail.customer_name || "—"}</strong></div>
                    <div><span>Email notifiche</span><strong>{detail.notification_email || "—"}</strong></div>
                    <div><span>Customer key</span><strong>{detail.customer_key || "—"}</strong></div>
                  </div>
                </section>

                <section className="adminPanel compactPanel">
                  <div className="panelTitle">Gestione ticket</div>
                  <button
                    className="takeOwnership"
                    onClick={() => void takeOwnership()}
                    disabled={saving}
                  >
                    Prendi in carico
                  </button>

                  <label>Stato
                    <select value={detail.status} onChange={(event)=>void patchTicket({status:event.target.value})}>
                      {STATUSES.map((value)=><option value={value} key={value}>{statusLabel(value)}</option>)}
                    </select>
                  </label>

                  <label>Priorità
                    <select value={detail.priority} onChange={(event)=>void patchTicket({priority:event.target.value})}>
                      {PRIORITIES.map((value)=><option value={value} key={value}>{priorityLabel(value)}</option>)}
                    </select>
                  </label>

                  <label>Reparto
                    <select value={detail.department || "OTHER"} onChange={(event)=>void patchTicket({department:event.target.value})}>
                      {DEPARTMENTS.map((value)=><option value={value} key={value}>{departmentLabel(value)}</option>)}
                    </select>
                  </label>

                  <label>Assegnatario
                    <input
                      value={detail.assignee || ""}
                      onChange={(event)=>setDetail({...detail,assignee:event.target.value})}
                      onBlur={(event)=>void patchTicket({assignee:event.target.value})}
                    />
                  </label>
                </section>

                <section className="adminPanel compactPanel">
                  <div className="panelTitle">Note interne · {(detail.notes || []).length}</div>
                  <form className="noteForm" onSubmit={saveNote}>
                    <textarea
                      value={note}
                      onChange={(event)=>setNote(event.target.value)}
                      placeholder="Aggiungi una nota interna…"
                    />
                    <button disabled={saving || !note.trim()}>Salva nota</button>
                  </form>
                  <div className="notesList">
                    {(detail.notes || []).map((item)=>(
                      <div className="noteItem" key={item.id}>
                        <strong>{item.author_name}</strong>
                        <span>{when(item.created_at)}</span>
                        <p>{item.content}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="adminPanel compactPanel timelinePanel">
                  <div className="panelTitle">Storico attività · {(detail.events || []).length}</div>
                  <div className="timeline">
                    {(detail.events || []).map((item)=>(
                      <div className="timelineItem" key={item.id}>
                        <strong>{item.type}</strong>
                        <span>{item.description}</span>
                        <small>{item.actor_name} · {when(item.created_at)}</small>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}

export default function BackofficePage() {
  return (
    <GemmaInternalAuth requiredRole="STAFF">
      {({ user, logout }) => (
        <BackofficeBody user={user} logout={logout} />
      )}
    </GemmaInternalAuth>
  );
}

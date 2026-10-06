"use client";

import { useEffect, useMemo, useState } from "react";
import PortalNav from "../../components/PortalNav";
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
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
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

function dateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function BackofficeArea() {
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("ACTIVE");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTickets() {
    const response = await fetch("/api/gemma/tickets?scope=all", {
      cache: "no-store",
    });
    const data = await response.json();
    const rows = Array.isArray(data.tickets) ? data.tickets : [];
    setTickets(rows);
    if (!selectedId && rows[0]?.id) setSelectedId(rows[0].id);
  }

  async function loadDetail(id) {
    if (!id) return setDetail(null);
    const response = await fetch(
      "/api/gemma/tickets/" + id + "?scope=staff",
      { cache: "no-store" },
    );
    const data = await response.json();
    setDetail(data.ticket || null);
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId]);

  const filteredTickets = useMemo(() => {
    if (filter === "ALL") return tickets;
    if (filter === "ACTIVE") {
      return tickets.filter(
        (ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status),
      );
    }
    return tickets.filter((ticket) => ticket.status === filter);
  }, [tickets, filter]);

  async function patchTicket(patch) {
    if (!selectedId) return;
    setBusy(true);
    try {
      await fetch("/api/gemma/tickets/" + selectedId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, actor: "Operatore Demo" }),
      });
      await Promise.all([loadDetail(selectedId), loadTickets()]);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/gemma/tickets/" + selectedId + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "OPERATOR",
          authorName: "Operatore Demo",
          content: reply.trim(),
        }),
      });
      setReply("");
      await Promise.all([loadDetail(selectedId), loadTickets()]);
    } finally {
      setBusy(false);
    }
  }

  async function addNote(event) {
    event.preventDefault();
    if (!selectedId || !note.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/gemma/tickets/" + selectedId + "/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authorName: "Operatore Demo",
          content: note.trim(),
        }),
      });
      setNote("");
      await loadDetail(selectedId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="portalPage">
      <div className="portalTop">
        <div>
          <div className="brand">TAAP <span>Gemma</span></div>
          <h1>Backoffice</h1>
          <p>Code operative, presa in carico e riepilogo dinamico del cliente.</p>
        </div>
        <PortalNav />
      </div>

      <div className="filterBar">
        {["ACTIVE", "ALL", "OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED"].map(
          (value) => (
            <button
              key={value}
              className={filter === value ? "filterActive" : ""}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ),
        )}
      </div>

      <div className="portalGrid backofficeGrid">
        <aside className="ticketListPanel">
          <div className="panelTitle">Coda ticket · {filteredTickets.length}</div>
          {filteredTickets.map((ticket) => (
            <button
              key={ticket.id}
              className={
                "ticketRow " + (selectedId === ticket.id ? "ticketRowActive" : "")
              }
              onClick={() => setSelectedId(ticket.id)}
            >
              <div className="ticketRowTop">
                <strong>#{ticket.number}</strong>
                <span className="statusPill">{ticket.status}</span>
              </div>
              <div>{ticket.state_json?.issue || "Segnalazione"}</div>
              <small>
                {ticket.department || "OTHER"} · {ticket.priority}
              </small>
            </button>
          ))}
        </aside>

        <section className="ticketDetailPanel">
          {!detail ? (
            <div className="emptyState">Seleziona un ticket dalla coda.</div>
          ) : (
            <>
              <div className="detailHeader">
                <div>
                  <span className="eyebrow">Ticket #{detail.number}</span>
                  <h2>{detail.state_json?.issue || "Segnalazione"}</h2>
                  <small>{detail.customer_name}</small>
                </div>
                <span className="statusPill">{detail.status}</span>
              </div>

              <div className="operatorControls">
                <label>
                  Stato
                  <select
                    value={detail.status}
                    onChange={(event) => patchTicket({ status: event.target.value })}
                    disabled={busy}
                  >
                    {STATUSES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Priorità
                  <select
                    value={detail.priority}
                    onChange={(event) => patchTicket({ priority: event.target.value })}
                    disabled={busy}
                  >
                    {PRIORITIES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Reparto
                  <select
                    value={detail.department || "OTHER"}
                    onChange={(event) => patchTicket({ department: event.target.value })}
                    disabled={busy}
                  >
                    {DEPARTMENTS.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Assegnatario
                  <input
                    defaultValue={detail.assignee || ""}
                    placeholder="Operatore Demo"
                    onBlur={(event) => patchTicket({ assignee: event.target.value })}
                  />
                </label>
              </div>

              <TicketSummary ticket={detail} />

              <div className="staffColumns">
                <section className="conversationCard">
                  <div className="panelTitle">Conversazione cliente</div>
                  <div className="ticketMessages">
                    {(detail.conversationMessages || []).map((message) => (
                      <div
                        key={message.id}
                        className={
                          "ticketBubble " +
                          (message.role === "USER" ? "customer" : "gemma")
                        }
                      >
                        <div className="ticketBubbleMeta">
                          {message.role === "USER" ? "Cliente" : "Gemma"} ·{" "}
                          {dateTime(message.created_at)}
                        </div>
                        <div>{message.content}</div>
                      </div>
                    ))}
                    {(detail.ticketMessages || []).map((message) => (
                      <div
                        key={message.id}
                        className={
                          "ticketBubble " +
                          (message.role === "CUSTOMER" ? "customer" : "operator")
                        }
                      >
                        <div className="ticketBubbleMeta">
                          {message.author_name || message.role} ·{" "}
                          {dateTime(message.created_at)}
                        </div>
                        <div>{message.content}</div>
                      </div>
                    ))}
                  </div>

                  <form className="ticketReply" onSubmit={sendReply}>
                    <input
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      placeholder="Rispondi al cliente…"
                    />
                    <button disabled={busy || !reply.trim()}>Invia</button>
                  </form>
                </section>

                <section className="conversationCard">
                  <div className="panelTitle">Note interne</div>
                  <form className="noteForm" onSubmit={addNote}>
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Aggiungi una nota interna…"
                    />
                    <button disabled={busy || !note.trim()}>Salva nota</button>
                  </form>
                  <div className="notesList">
                    {(detail.notes || []).map((item) => (
                      <div className="noteItem" key={item.id}>
                        <strong>{item.author_name}</strong>
                        <span>{dateTime(item.created_at)}</span>
                        <p>{item.content}</p>
                      </div>
                    ))}
                  </div>

                  <div className="panelTitle timelineTitle">Timeline</div>
                  <div className="timeline">
                    {(detail.events || []).map((item) => (
                      <div className="timelineItem" key={item.id}>
                        <strong>{item.type}</strong>
                        <span>{item.description}</span>
                        <small>
                          {item.actor_name} · {dateTime(item.created_at)}
                        </small>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

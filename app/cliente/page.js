"use client";

import { useEffect, useMemo, useState } from "react";
import PortalNav from "../../components/PortalNav";
import TicketSummary from "../../components/TicketSummary";

function dateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function CustomerArea() {
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTickets() {
    await fetch("/api/gemma/session", { cache: "no-store" });
    const response = await fetch("/api/gemma/tickets", { cache: "no-store" });
    const data = await response.json();
    const rows = Array.isArray(data.tickets) ? data.tickets : [];
    setTickets(rows);
    if (!selectedId && rows[0]?.id) setSelectedId(rows[0].id);
  }

  async function loadDetail(id) {
    if (!id) {
      setDetail(null);
      return;
    }
    const response = await fetch("/api/gemma/tickets/" + id, {
      cache: "no-store",
    });
    const data = await response.json();
    setDetail(data.ticket || null);
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId]);

  async function sendReply(event) {
    event.preventDefault();
    if (!selectedId || !reply.trim() || busy) return;

    setBusy(true);
    try {
      await fetch("/api/gemma/tickets/" + selectedId + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "CUSTOMER",
          authorName: "Cliente",
          content: reply.trim(),
        }),
      });
      setReply("");
      await Promise.all([loadDetail(selectedId), loadTickets()]);
    } finally {
      setBusy(false);
    }
  }

  const visibleMessages = useMemo(() => {
    if (!detail) return [];
    return [
      ...(detail.conversationMessages || []).map((item) => ({
        ...item,
        source: "conversation",
      })),
      ...(detail.ticketMessages || []).map((item) => ({
        ...item,
        source: "ticket",
      })),
    ].sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
  }, [detail]);

  return (
    <main className="portalPage">
      <div className="portalTop">
        <div>
          <div className="brand">TAAP <span>Gemma</span></div>
          <h1>Area cliente</h1>
          <p>Segui le segnalazioni aperte con Gemma e rispondi al backoffice.</p>
        </div>
        <PortalNav />
      </div>

      <div className="portalGrid">
        <aside className="ticketListPanel">
          <div className="panelTitle">Le tue segnalazioni</div>
          {tickets.length === 0 ? (
            <div className="emptyState">
              Nessun ticket aperto. Quando Gemma propone una segnalazione,
              puoi aprirla direttamente dalla chat.
            </div>
          ) : (
            tickets.map((ticket) => (
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
                <small>{dateTime(ticket.updated_at)}</small>
              </button>
            ))
          )}
        </aside>

        <section className="ticketDetailPanel">
          {!detail ? (
            <div className="emptyState">Seleziona una segnalazione.</div>
          ) : (
            <>
              <div className="detailHeader">
                <div>
                  <span className="eyebrow">Ticket #{detail.number}</span>
                  <h2>{detail.state_json?.issue || "Segnalazione"}</h2>
                </div>
                <div className="detailMeta">
                  <span className="statusPill">{detail.status}</span>
                  <span>{detail.department || "OTHER"}</span>
                </div>
              </div>

              <TicketSummary ticket={detail} />

              <section className="conversationCard">
                <div className="panelTitle">Conversazione e aggiornamenti</div>
                <div className="ticketMessages">
                  {visibleMessages.map((message, index) => {
                    const role =
                      message.role === "USER" || message.role === "CUSTOMER"
                        ? "customer"
                        : message.role === "GEMMA"
                          ? "gemma"
                          : "operator";
                    return (
                      <div key={message.id || index} className={"ticketBubble " + role}>
                        <div className="ticketBubbleMeta">
                          {role === "customer"
                            ? "Tu"
                            : role === "gemma"
                              ? "Gemma"
                              : message.author_name || "Backoffice"}{" "}
                          · {dateTime(message.created_at)}
                        </div>
                        <div>{message.content}</div>
                      </div>
                    );
                  })}
                </div>

                <form className="ticketReply" onSubmit={sendReply}>
                  <input
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Scrivi al backoffice…"
                  />
                  <button disabled={busy || !reply.trim()}>Invia</button>
                </form>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

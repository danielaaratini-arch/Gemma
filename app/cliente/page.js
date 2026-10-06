"use client";

import { useEffect, useMemo, useState } from "react";
import GemmaCustomerHeader from "../../components/GemmaCustomerHeader";
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
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

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

  async function uploadAttachments(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedId || files.length === 0 || uploadBusy) return;

    setUploadBusy(true);
    setUploadError("");

    try {
      const formData = new FormData();
      for (const file of files) formData.append("files", file);

      const response = await fetch(
        "/api/gemma/tickets/" + selectedId + "/attachments",
        {
          method: "POST",
          body: formData,
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Caricamento non riuscito.");
      }

      await Promise.all([loadDetail(selectedId), loadTickets()]);
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Caricamento non riuscito.",
      );
    } finally {
      setUploadBusy(false);
    }
  }

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
    <main className="gemmaCustomerPage">
      <GemmaCustomerHeader />

      <section className="gemmaCustomerContent">
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

                <section className="conversationCard attachmentCard">
                  <div className="panelTitle">Allegati</div>

                  <div className="attachmentList">
                    {(detail.attachments || []).length === 0 ? (
                      <span className="attachmentEmpty">Nessun allegato.</span>
                    ) : (
                      (detail.attachments || []).map((file) => (
                        <a
                          key={file.id}
                          className="attachmentItem"
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span>📎 {file.original_name}</span>
                          <small>
                            {Math.max(1, Math.round(Number(file.size_bytes || 0) / 1024))} KB
                          </small>
                        </a>
                      ))
                    )}
                  </div>

                  <label className="attachmentUpload">
                    {uploadBusy ? "Caricamento…" : "Allega documenti"}
                    <input
                      type="file"
                      multiple
                      disabled={uploadBusy}
                      accept=".pdf,.txt,.rtf,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.bmp,.tif,.tiff,.mp3,.m4a,.aac,.wav,.ogg,.oga,.webm,.amr,.mp4,.mov,.m4v,.3gp,.3g2,.mpeg,.mpg,.avi,.mkv"
                      onChange={uploadAttachments}
                    />
                  </label>

                  <small className="attachmentLimits">
                    Max 5 file alla volta · 5 MB per file · 10 MB per ticket
                  </small>

                  {uploadError ? (
                    <p className="attachmentError">{uploadError}</p>
                  ) : null}
                </section>

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
      </section>
    </main>
  );}

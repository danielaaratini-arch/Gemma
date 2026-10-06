"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [pendingFiles, setPendingFiles] = useState([]);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSaved, setRatingSaved] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [micListening, setMicListening] = useState(false);
  const [micError, setMicError] = useState("");
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const recognitionPrefixRef = useRef("");

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
    if (typeof window === "undefined") return;

    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition) {
      setMicSupported(false);
      return;
    }

    setMicSupported(true);

    const recognition = new Recognition();
    recognition.lang = "it-IT";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript || "";
      }

      const prefix = recognitionPrefixRef.current;
      const separator =
        prefix && transcript && !/\s$/.test(prefix) ? " " : "";

      setReply((prefix + separator + transcript).trimStart());
      setMicError("");
    };

    recognition.onerror = (event) => {
      setMicListening(false);

      if (
        event?.error === "not-allowed" ||
        event?.error === "service-not-allowed"
      ) {
        setMicError(
          "Consenti l’uso del microfono per dettare il messaggio.",
        );
      } else if (
        event?.error !== "aborted" &&
        event?.error !== "no-speech"
      ) {
        setMicError("Non riesco ad ascoltare in questo momento.");
      }
    };

    recognition.onend = () => {
      setMicListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.abort();
      } catch {}
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      recognitionRef.current?.abort();
    } catch {}
    setMicListening(false);
    setMicError("");
    void loadDetail(selectedId);
  }, [selectedId]);

  function toggleMicrophone() {
    if (!micSupported || busy || uploadBusy) return;

    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (micListening) {
      try {
        recognition.stop();
      } catch {}
      setMicListening(false);
      return;
    }

    recognitionPrefixRef.current = reply.trim();
    setMicError("");

    try {
      recognition.start();
      setMicListening(true);
    } catch {
      setMicListening(false);
      setMicError("Il microfono è già in uso. Riprova.");
    }
  }

  function chooseAttachments(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    setUploadError("");

    const next = [...pendingFiles, ...selected].slice(0, 5);

    for (const file of next) {
      if (file.size > 5 * 1024 * 1024) {
        setUploadError("Ogni file può avere una dimensione massima di 5 MB.");
        return;
      }
    }

    const total = next.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (total > 10 * 1024 * 1024) {
      setUploadError("Gli allegati selezionati superano il limite complessivo di 10 MB.");
      return;
    }

    setPendingFiles(next);
  }

  function removePendingFile(index) {
    setPendingFiles((current) =>
      current.filter((_, fileIndex) => fileIndex !== index),
    );
  }

  function formatFileSize(size) {
    if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function sendRating() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const response = await fetch(
        "/api/gemma/tickets/" + selectedId + "/rating",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            score: ratingScore,
            comment: ratingComment.trim(),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Valutazione non salvata.");
      }
      setRatingSaved(true);
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Valutazione non salvata.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    const text = reply.trim();
    if (
      !selectedId ||
      busy ||
      uploadBusy ||
      (!text && pendingFiles.length === 0)
    ) {
      return;
    }

    if (micListening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setMicListening(false);
    }

    setBusy(true);
    setUploadBusy(pendingFiles.length > 0);
    setUploadError("");
    setMicError("");

    try {
      if (text) {
        const messageResponse = await fetch(
          "/api/gemma/tickets/" + selectedId + "/messages",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              role: "CUSTOMER",
              authorName: "Cliente",
              content: text,
            }),
          },
        );

        if (!messageResponse.ok) {
          const data = await messageResponse.json().catch(() => ({}));
          throw new Error(data?.error || "Messaggio non inviato.");
        }
      }

      if (pendingFiles.length > 0) {
        const formData = new FormData();
        for (const file of pendingFiles) formData.append("files", file);

        const uploadResponse = await fetch(
          "/api/gemma/tickets/" + selectedId + "/attachments",
          {
            method: "POST",
            body: formData,
          },
        );
        const data = await uploadResponse.json().catch(() => ({}));

        if (!uploadResponse.ok) {
          throw new Error(data?.error || "Allegati non inviati.");
        }
      }

      setReply("");
      setPendingFiles([]);
      await Promise.all([loadDetail(selectedId), loadTickets()]);
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Invio non riuscito.",
      );
    } finally {
      setBusy(false);
      setUploadBusy(false);
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
      ...(detail.attachments || []).map((item) => ({
        id: "attachment-" + item.id,
        role: "CUSTOMER",
        content: "",
        created_at: item.created_at,
        source: "attachment",
        attachment: item,
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

                {["RESOLVED", "CLOSED"].includes(detail.status) ? (
                  <section className="conversationCard ratingCard">
                    <div className="panelTitle">Valuta l’assistenza</div>
                    {ratingSaved ? (
                      <div className="ratingThanks">Grazie per la tua valutazione.</div>
                    ) : (
                      <>
                        <div className="ratingStars">
                          {[1,2,3,4,5].map((score)=>(
                            <button
                              key={score}
                              type="button"
                              className={score <= ratingScore ? "active" : ""}
                              onClick={()=>setRatingScore(score)}
                              aria-label={score + " stelle"}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={ratingComment}
                          onChange={(event)=>setRatingComment(event.target.value)}
                          placeholder="Commento facoltativo…"
                          rows={3}
                        />
                        <button className="internalPrimaryButton" onClick={()=>void sendRating()} disabled={busy}>
                          Invia valutazione
                        </button>
                      </>
                    )}
                  </section>
                ) : null}

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
                          {message.source === "attachment" ? (
                            <a
                              className="chatAttachmentBubble"
                              href={message.attachment.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span className="chatAttachmentIcon" aria-hidden="true">
                                📎
                              </span>
                              <span className="chatAttachmentInfo">
                                <strong>{message.attachment.original_name}</strong>
                                <small>
                                  {formatFileSize(
                                    Number(message.attachment.size_bytes || 0),
                                  )}
                                </small>
                              </span>
                            </a>
                          ) : (
                            <div>{message.content}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <form className="ticketChatComposer" onSubmit={sendReply}>
                    {pendingFiles.length > 0 ? (
                      <div className="ticketComposerFiles">
                        {pendingFiles.map((file, index) => (
                          <div
                            className="ticketComposerFileChip"
                            key={file.name + "-" + file.size + "-" + index}
                          >
                            <span className="ticketComposerFileIcon" aria-hidden="true">
                              📎
                            </span>
                            <span className="ticketComposerFileInfo">
                              <strong>{file.name}</strong>
                              <small>{formatFileSize(file.size)}</small>
                            </span>
                            <button
                              type="button"
                              className="ticketComposerFileRemove"
                              onClick={() => removePendingFile(index)}
                              aria-label={"Rimuovi " + file.name}
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
                        disabled={busy || uploadBusy || pendingFiles.length >= 5}
                        aria-label="Allega file"
                        title="Allega file"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                      </button>

                      <input
                        ref={fileInputRef}
                        className="ticketFileInput"
                        type="file"
                        multiple
                        accept=".pdf,.txt,.rtf,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.bmp,.tif,.tiff,.mp3,.m4a,.aac,.wav,.ogg,.oga,.webm,.amr,.mp4,.mov,.m4v,.3gp,.3g2,.mpeg,.mpg,.avi,.mkv"
                        onChange={chooseAttachments}
                      />

                      {micSupported ? (
                        <button
                          type="button"
                          className={
                            micListening
                              ? "gemmaMicButton ticketMicButton listening"
                              : "gemmaMicButton ticketMicButton"
                          }
                          onClick={toggleMicrophone}
                          disabled={busy || uploadBusy}
                          aria-label={
                            micListening
                              ? "Ferma dettatura"
                              : "Detta il messaggio"
                          }
                          title={
                            micListening
                              ? "Ferma dettatura"
                              : "Detta il messaggio"
                          }
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="2" width="6" height="12" rx="3" />
                            <path d="M5 10a7 7 0 0 0 14 0" />
                            <path d="M12 17v5" />
                            <path d="M8 22h8" />
                          </svg>
                        </button>
                      ) : null}

                      <input
                        className="ticketComposerText"
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder={
                          micListening
                            ? "Ti ascolto…"
                            : "Scrivi o detta un messaggio…"
                        }
                      />

                      <button
                        className="ticketSendButton"
                        disabled={
                          busy ||
                          uploadBusy ||
                          (!reply.trim() && pendingFiles.length === 0)
                        }
                      >
                        {busy || uploadBusy ? "…" : "Invia"}
                      </button>
                    </div>

                    <div className="ticketComposerHint">
                      Allegati: max 5 file · 5 MB per file · 10 MB per ticket
                    </div>

                    {uploadError ? (
                      <p className="attachmentError">{uploadError}</p>
                    ) : null}

                    {micError ? (
                      <p className="attachmentError">{micError}</p>
                    ) : null}
                  </form>
                </section>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );}

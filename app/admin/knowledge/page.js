"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import GemmaInternalAuth from "../../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../../components/GemmaInternalNav";

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function KnowledgeBody({ user, logout }) {
  const [documents, setDocuments] = useState([]);
  const [docSearch, setDocSearch] = useState("");
  const [docStatus, setDocStatus] = useState("ALL");
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [noMatchHint, setNoMatchHint] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEditId, setManualEditId] = useState(null);
  const [manualForm, setManualForm] = useState({
    title: "",
    description: "",
    content: "",
    category: "GENERAL",
    serviceType: "",
    assistanceArea: "",
    topic: "",
    usageHints: "",
    deviceScope: "",
    status: "DRAFT",
  });

  async function loadDocuments() {
    const params = new URLSearchParams({
      search: docSearch,
      status: docStatus,
      limit: "300",
    });
    const response = await fetch(
      "/api/gemma/admin/knowledge?" + params.toString(),
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Knowledge non disponibile.");
    }
    setDocuments(data.documents || []);
  }

  async function loadJobs() {
    const response = await fetch("/api/gemma/admin/knowledge-sync", {
      cache: "no-store",
    });
    const data = await response.json();
    if (response.ok) setJobs(data.jobs || []);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hint = params.get("noMatch") || "";
    setNoMatchHint(hint);

    if (hint) {
      setManualOpen(true);
      setManualForm((current) => ({
        ...current,
        title: hint.slice(0, 180),
        usageHints: hint.slice(0, 1000),
      }));
    }

    void Promise.all([loadDocuments(), loadJobs()]).catch((caught) =>
      setError(
        caught instanceof Error
          ? caught.message
          : "Knowledge non disponibile.",
      ),
    );
  }, []);

  function resetManualForm() {
    setManualEditId(null);
    setManualForm({
      title: noMatchHint ? noMatchHint.slice(0, 180) : "",
      description: "",
      content: "",
      category: "GENERAL",
      serviceType: "",
      assistanceArea: "",
      topic: "",
      usageHints: noMatchHint ? noMatchHint.slice(0, 1000) : "",
      deviceScope: "",
      status: "DRAFT",
    });
  }

  async function saveManualDocument(event) {
    event.preventDefault();
    if (busy) return;

    setBusy("manual");
    setError("");

    try {
      const url = manualEditId
        ? "/api/gemma/admin/knowledge/" + manualEditId
        : "/api/gemma/admin/knowledge";
      const response = await fetch(url, {
        method: manualEditId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(manualForm),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Documento Knowledge non salvato.");
      }

      resetManualForm();
      setManualOpen(false);
      await loadDocuments();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Documento Knowledge non salvato.",
      );
    } finally {
      setBusy("");
    }
  }

  async function editKnowledgeDocument(id) {
    setBusy("manual-load");
    setError("");

    try {
      const response = await fetch(
        "/api/gemma/admin/knowledge/" + id,
        { cache: "no-store" },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Documento Knowledge non disponibile.");
      }

      const item = data.document;
      setManualEditId(item.id);
      setManualForm({
        title: item.title || "",
        description: item.description || "",
        content: item.content || "",
        category: item.category || "GENERAL",
        serviceType: item.service_type || "",
        assistanceArea: item.assistance_area || "",
        topic: item.topic || "",
        usageHints: item.usage_hints || "",
        deviceScope: item.device_scope || "",
        status: item.status || "DRAFT",
      });
      setManualOpen(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Documento Knowledge non disponibile.",
      );
    } finally {
      setBusy("");
    }
  }

  async function setKnowledgeStatus(id, status) {
    setBusy("status");
    setError("");

    try {
      const response = await fetch(
        "/api/gemma/admin/knowledge/" + id,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Stato Knowledge non aggiornato.");
      }

      await loadDocuments();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Stato Knowledge non aggiornato.",
      );
    } finally {
      setBusy("");
    }
  }

  async function syncRequest(payload) {
    const response = await fetch("/api/gemma/admin/knowledge-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Operazione Knowledge non riuscita.");
    }
    return data.job;
  }

  async function startPreview() {
    if (busy) return;
    setBusy("preview");
    setError("");
    setSelectedIds([]);

    try {
      let current = await syncRequest({ action: "start-preview" });
      setJob(current);

      while (current?.status === "PREVIEWING") {
        await wait(120);
        current = await syncRequest({
          action: "step-preview",
          jobId: current.id,
          batchSize: 8,
        });
        setJob(current);
      }

      const defaultSelection = (current?.proposals || [])
        .filter(
          (item) =>
            item?.metadata_json?.safetyStatus === "SAFE",
        )
        .map((item) => item.id);
      setSelectedIds(defaultSelection);
      await loadJobs();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Preview Knowledge non riuscita.",
      );
    } finally {
      setBusy("");
    }
  }

  async function applySelected() {
    if (!job?.id || selectedIds.length === 0 || busy) return;
    setBusy("apply");
    setError("");

    try {
      let current = await syncRequest({
        action: "start-apply",
        jobId: job.id,
        proposalIds: selectedIds,
      });
      setJob(current);

      while (current?.status === "APPLYING") {
        await wait(100);
        current = await syncRequest({
          action: "step-apply",
          jobId: current.id,
          batchSize: 10,
        });
        setJob(current);
      }

      await Promise.all([loadDocuments(), loadJobs()]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Apply Knowledge non riuscito.",
      );
    } finally {
      setBusy("");
    }
  }

  async function rollback() {
    if (!job?.id || busy) return;
    if (
      !window.confirm(
        "Ripristinare la Knowledge precedente a questo Apply?",
      )
    ) {
      return;
    }

    setBusy("rollback");
    setError("");

    try {
      let current = job;

      do {
        current = await syncRequest({
          action: "rollback-step",
          jobId: job.id,
          batchSize: 10,
        });
        setJob(current);
        if (current?.status !== "ROLLED_BACK") await wait(100);
      } while (current?.status !== "ROLLED_BACK");

      await Promise.all([loadDocuments(), loadJobs()]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Rollback Knowledge non riuscito.",
      );
    } finally {
      setBusy("");
    }
  }

  async function openJob(jobId) {
    const response = await fetch(
      "/api/gemma/admin/knowledge-sync?jobId=" +
        encodeURIComponent(jobId),
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok) {
      setError(data?.error || "Job non disponibile.");
      return;
    }
    setJob(data.job);
    setSelectedIds(
      (data.job?.proposals || [])
        .filter((item) => item.selected)
        .map((item) => item.id),
    );
  }

  const counts = useMemo(
    () => ({
      total: documents.length,
      active: documents.filter((item) => item.status === "ACTIVE").length,
      archived: documents.filter((item) => item.status === "ARCHIVED").length,
      chunks: documents.reduce(
        (sum, item) => sum + Number(item.chunks || 0),
        0,
      ),
    }),
    [documents],
  );

  const proposalCounts = useMemo(() => {
    const rows = job?.proposals || [];
    return {
      create: rows.filter((item) => item.action === "CREATE").length,
      update: rows.filter((item) => item.action === "UPDATE").length,
      archive: rows.filter((item) => item.action === "ARCHIVE").length,
      review: rows.filter(
        (item) => item?.metadata_json?.safetyStatus !== "SAFE",
      ).length,
      applied: rows.filter((item) => item.applied_at).length,
      failed: rows.filter((item) => item.apply_error).length,
    };
  }, [job]);

  function toggleProposal(id) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  const previewPercent = job?.discovered
    ? Math.min(
        100,
        Math.round(
          (Number(job.processed || 0) / Number(job.discovered || 1)) * 100,
        ),
      )
    : 0;

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout} />

      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">Knowledge condivisa</p>
            <h1>Knowledge Base</h1>
            <p>
              Un solo corpus per Lia, Alda e Gemma. Gemma prepara la
              Preview in tabelle operative proprie e scrive sulla Knowledge
              condivisa soltanto dopo conferma dell’Admin. Le proposte non
              affidabili restano bloccate in revisione e i nuovi documenti
              vengono creati come DRAFT.
            </p>
          </div>

          <Link href="/admin/no-match" className="internalPrimaryLink">
            No Match
          </Link>
        </div>

        {noMatchHint ? (
          <div className="knowledgeNoMatchHint">
            <strong>Richiesta No Match da analizzare</strong>
            <span>{noMatchHint}</span>
          </div>
        ) : null}

        {error ? <div className="internalError">{error}</div> : null}

        <section className="adminPanel knowledgeManualPanel">
          <div className="knowledgeManualHead">
            <div>
              <div className="panelTitle">
                {manualEditId ? "Modifica Knowledge" : "Integra Knowledge"}
              </div>
              <p>
                Aggiungi o correggi contenuti certificati. I nuovi documenti
                partono come DRAFT per impostazione predefinita.
              </p>
            </div>
            <button
              type="button"
              className="secondaryAction"
              onClick={() => {
                if (manualOpen) resetManualForm();
                setManualOpen((current) => !current);
              }}
            >
              {manualOpen ? "Chiudi" : "Nuovo documento"}
            </button>
          </div>

          {manualOpen ? (
            <form className="knowledgeManualForm" onSubmit={saveManualDocument}>
              <label className="span2">
                Titolo
                <input
                  value={manualForm.title}
                  onChange={(event) =>
                    setManualForm({ ...manualForm, title: event.target.value })
                  }
                  required
                />
              </label>

              <label>
                Servizio
                <select
                  value={manualForm.serviceType}
                  onChange={(event) =>
                    setManualForm({
                      ...manualForm,
                      serviceType: event.target.value,
                    })
                  }
                >
                  <option value="">Generale</option>
                  <option value="MOBILE">Mobile</option>
                  <option value="FIXED_NETWORK">Rete fissa</option>
                  <option value="EMAIL">Email</option>
                  <option value="PEC">PEC</option>
                  <option value="ADMINISTRATIVE">Amministrativo</option>
                  <option value="COMMERCIAL">Commerciale</option>
                </select>
              </label>

              <label>
                Stato
                <select
                  value={manualForm.status}
                  onChange={(event) =>
                    setManualForm({ ...manualForm, status: event.target.value })
                  }
                >
                  <option value="DRAFT">DRAFT</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                </select>
              </label>

              <label>
                Area
                <input
                  value={manualForm.assistanceArea}
                  onChange={(event) =>
                    setManualForm({
                      ...manualForm,
                      assistanceArea: event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Topic
                <input
                  value={manualForm.topic}
                  onChange={(event) =>
                    setManualForm({ ...manualForm, topic: event.target.value })
                  }
                />
              </label>

              <label className="span2">
                Richieste coperte
                <textarea
                  rows={3}
                  value={manualForm.usageHints}
                  onChange={(event) =>
                    setManualForm({
                      ...manualForm,
                      usageHints: event.target.value,
                    })
                  }
                />
              </label>

              <label className="span2">
                Contenuto certificato
                <textarea
                  rows={10}
                  value={manualForm.content}
                  onChange={(event) =>
                    setManualForm({ ...manualForm, content: event.target.value })
                  }
                  required
                />
              </label>

              <div className="knowledgeManualActions span2">
                <button className="internalPrimaryButton" disabled={busy === "manual"}>
                  {busy === "manual"
                    ? "Salvataggio…"
                    : manualEditId
                      ? "Salva modifiche"
                      : "Crea documento"}
                </button>
                {manualEditId ? (
                  <button
                    type="button"
                    className="secondaryAction"
                    onClick={resetManualForm}
                  >
                    Nuovo
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </section>

        <section className="statGrid">
          <article className="statCard">
            <span>Documenti</span>
            <strong>{counts.total}</strong>
          </article>
          <article className="statCard">
            <span>Attivi</span>
            <strong>{counts.active}</strong>
          </article>
          <article className="statCard">
            <span>Archiviati</span>
            <strong>{counts.archived}</strong>
          </article>
          <article className="statCard">
            <span>Chunk</span>
            <strong>{counts.chunks}</strong>
          </article>
        </section>

        <section className="adminPanel knowledgeSyncPanel">
          <div className="knowledgeSyncHead">
            <div>
              <div className="panelTitle">Aggiornamento massivo</div>
              <p>
                Le sorgenti vengono analizzate a piccoli batch compatibili
                con Vercel. Nessuna modifica avviene durante la Preview.
              </p>
            </div>

            <div className="knowledgeSyncActions">
              <button
                className="internalPrimaryButton"
                onClick={() => void startPreview()}
                disabled={Boolean(busy)}
              >
                {busy === "preview"
                  ? "Preview in corso…"
                  : "Aggiorna / Preview"}
              </button>

              <button
                className="secondaryAction"
                onClick={() => void applySelected()}
                disabled={
                  Boolean(busy) ||
                  !job ||
                  job.status !== "PREVIEW_READY" ||
                  selectedIds.length === 0
                }
              >
                {busy === "apply"
                  ? "Apply in corso…"
                  : "Apply selezionati (" + selectedIds.length + ")"}
              </button>

              <button
                className="dangerAction"
                onClick={() => void rollback()}
                disabled={
                  Boolean(busy) ||
                  !job ||
                  !["APPLIED", "APPLY_PARTIAL"].includes(job.status) ||
                  Number(job.snapshots?.total || 0) === 0
                }
              >
                {busy === "rollback" ? "Rollback…" : "Rollback ultimo Apply"}
              </button>
            </div>
          </div>

          {job ? (
            <div className="knowledgeJobCard">
              <div className="knowledgeJobTop">
                <div>
                  <strong>{job.status}</strong>
                  <span>
                    {Number(job.processed || 0)} /{" "}
                    {Number(job.discovered || 0)} pagine elaborate
                  </span>
                </div>
                <div className="knowledgeJobBadges">
                  <span>Nuovi {proposalCounts.create}</span>
                  <span>Modificati {proposalCounts.update}</span>
                  <span>Da archiviare {proposalCounts.archive}</span>
                  <span>Da rivedere {proposalCounts.review}</span>
                  <span>Errori fetch {job.errors || 0}</span>
                </div>
              </div>

              {job.status === "PREVIEWING" ? (
                <div className="knowledgeProgress">
                  <i style={{ width: previewPercent + "%" }} />
                </div>
              ) : null}

              {(job.queue || []).length ? (
                <div className="knowledgeSourceProgress">
                  {(job.queue || []).map((source) => (
                    <div key={source.source_name}>
                      <strong>{source.source_name}</strong>
                      <span>
                        {source.processed}/{source.discovered} · errori{" "}
                        {source.errors}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {job?.proposals?.length ? (
            <div className="knowledgeProposalList">
              {job.proposals.map((proposal) => (
                <label
                  className={
                    proposal.apply_error
                      ? "knowledgeProposal error"
                      : proposal.applied_at
                        ? "knowledgeProposal applied"
                        : "knowledgeProposal"
                  }
                  key={proposal.id}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(proposal.id)}
                    onChange={() => toggleProposal(proposal.id)}
                    disabled={
                      Boolean(busy) ||
                      job.status !== "PREVIEW_READY" ||
                      proposal?.metadata_json?.safetyStatus !== "SAFE"
                    }
                  />

                  <span className={"knowledgeActionBadge " + proposal.action.toLowerCase()}>
                    {proposal.action}
                  </span>

                  <span className="knowledgeProposalMain">
                    <strong>{proposal.title}</strong>
                    <small>
                      {proposal.source_name} · {proposal.source_url}
                    </small>
                    {proposal?.metadata_json?.safetyStatus !== "SAFE" ? (
                      <em>
                        Revisione richiesta:{" "}
                        {proposal?.metadata_json?.safetyReason ||
                          "controllo manuale necessario"}
                      </em>
                    ) : proposal.apply_error ? (
                      <em>{proposal.apply_error}</em>
                    ) : proposal.action === "CREATE" ? (
                      <em>
                        Verrà creato come DRAFT: sarà visibile nella Knowledge
                        ma non usato dagli assistenti finché non viene attivato.
                      </em>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          ) : job?.status === "PREVIEW_READY" ? (
            <div className="emptyState">
              Preview completata: nessuna variazione rilevata.
            </div>
          ) : null}

          {jobs.length ? (
            <details className="knowledgeHistory">
              <summary>Ultime operazioni Knowledge</summary>
              <div>
                {jobs.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => void openJob(item.id)}
                  >
                    <strong>{item.status}</strong>
                    <span>
                      {new Date(item.created_at).toLocaleString("it-IT")} ·{" "}
                      {item.proposals} proposte
                    </span>
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <section className="adminPanel recentPanel">
          <div className="knowledgeToolbar">
            <input
              value={docSearch}
              onChange={(event) => setDocSearch(event.target.value)}
              placeholder="Cerca nella Knowledge…"
            />

            <select
              value={docStatus}
              onChange={(event) => setDocStatus(event.target.value)}
            >
              <option value="ALL">Tutti gli stati</option>
              <option value="ACTIVE">Attivi</option>
              <option value="DRAFT">Bozze</option>
              <option value="ARCHIVED">Archiviati</option>
            </select>

            <button
              onClick={() =>
                void loadDocuments().catch((caught) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "Ricerca non riuscita.",
                  ),
                )
              }
            >
              Cerca
            </button>
          </div>

          <div className="knowledgeTable">
            <div className="knowledgeTableHead">
              <span>Titolo</span>
              <span>Servizio</span>
              <span>Area</span>
              <span>Stato</span>
              <span>Chunk</span>
            </div>

            {documents.map((item) => (
              <div className="knowledgeTableRow" key={item.id}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.topic || item.category || "—"}</small>
                </span>
                <span>{item.service_type || "—"}</span>
                <span>{item.assistance_area || "—"}</span>
                <span className="statusPill">{item.status}</span>
                <span>{item.chunks}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="knowledgeReadOnlyNotice">
          Le conversazioni di Gemma continuano a leggere la Knowledge in
          sola lettura. Le sole scritture sul corpus condiviso avvengono
          attraverso questo flusso Admin con Preview, selezione, Apply e
          snapshot di Rollback.
        </div>
      </section>
    </main>
  );
}

export default function AdminKnowledgePage() {
  return (
    <GemmaInternalAuth requiredRole="ADMIN">
      {({ user, logout }) => (
        <KnowledgeBody user={user} logout={logout} />
      )}
    </GemmaInternalAuth>
  );
}

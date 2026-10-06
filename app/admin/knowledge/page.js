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
    setNoMatchHint(params.get("noMatch") || "");
    void Promise.all([loadDocuments(), loadJobs()]).catch((caught) =>
      setError(
        caught instanceof Error
          ? caught.message
          : "Knowledge non disponibile.",
      ),
    );
  }, []);

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
        .filter((item) => item.action !== "ARCHIVE")
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
              condivisa soltanto dopo conferma dell’Admin.
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
                      job.status !== "PREVIEW_READY"
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
                    {proposal.apply_error ? (
                      <em>{proposal.apply_error}</em>
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

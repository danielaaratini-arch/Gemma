"use client";

import { useEffect, useMemo, useState } from "react";
import GemmaInternalAuth from "../../components/GemmaInternalAuth";
import GemmaInternalNav from "../../components/GemmaInternalNav";

function AdminDashboardBody({ user, logout }) {
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [dashboardResponse, healthResponse] = await Promise.all([
        fetch("/api/gemma/admin/dashboard", { cache: "no-store" }),
        fetch("/api/health", { cache: "no-store" }),
      ]);

      const dashboard = await dashboardResponse.json();
      if (!dashboardResponse.ok) {
        throw new Error(dashboard?.error || "Dashboard non disponibile.");
      }

      setData(dashboard);
      setHealth(await healthResponse.json());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Dashboard non disponibile.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const ticketTotals = useMemo(() => {
    const rows = Array.isArray(data?.tickets) ? data.tickets : [];
    return rows.reduce(
      (acc, item) => {
        const count = Number(item.count || 0);
        acc.total += count;
        if (!["RESOLVED", "CLOSED"].includes(item.status)) acc.active += count;
        return acc;
      },
      { total: 0, active: 0 },
    );
  }, [data]);

  const departmentRows = useMemo(() => {
    const map = new Map();
    for (const item of data?.tickets || []) {
      if (["RESOLVED", "CLOSED"].includes(item.status)) continue;
      const key = item.department || "OTHER";
      map.set(key, (map.get(key) || 0) + Number(item.count || 0));
    }
    return Array.from(map, ([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const userCount = (role) =>
    (data?.users || []).find((item) => item.role === role)?.count || 0;

  return (
    <main className="internalPage">
      <GemmaInternalNav role="ADMIN" user={user} onLogout={logout} />

      <section className="internalContent">
        <div className="internalTitleRow">
          <div>
            <p className="internalEyebrow">Gemma Control Center</p>
            <h1>Dashboard amministrativa</h1>
            <p>
              Stato operativo, utilizzo AI, ticket, knowledge e accessi interni.
            </p>
          </div>
          <button className="internalRefresh" onClick={() => void load()}>
            Aggiorna
          </button>
        </div>

        {error ? <div className="internalError">{error}</div> : null}

        <section className="statGrid">
          <article className="statCard">
            <span>Conversazioni</span>
            <strong>{data?.conversations?.total ?? "—"}</strong>
            <small>{data?.conversations?.active ?? 0} attive</small>
          </article>

          <article className="statCard">
            <span>Ticket</span>
            <strong>{data ? ticketTotals.total : "—"}</strong>
            <small>{ticketTotals.active} attivi</small>
          </article>

          <article className="statCard">
            <span>Turni AI</span>
            <strong>{data?.messages?.total_turns ?? "—"}</strong>
            <small>
              {data?.messages?.avg_total_ms
                ? data.messages.avg_total_ms + " ms medi"
                : "nessuna misura"}
            </small>
          </article>

          <article className="statCard">
            <span>Knowledge</span>
            <strong>{data?.knowledge?.active_documents ?? "—"}</strong>
            <small>{data?.knowledge?.chunks ?? 0} chunk attivi</small>
          </article>
        </section>

        <div className="adminColumns">
          <section className="adminPanel">
            <div className="panelTitle">Coda per reparto</div>
            {departmentRows.length === 0 ? (
              <div className="emptyState">Nessun ticket attivo.</div>
            ) : (
              <div className="metricList">
                {departmentRows.map((item) => (
                  <div className="metricRow" key={item.department}>
                    <span>{item.department}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="adminPanel">
            <div className="panelTitle">Qualità operativa</div>
            <div className="metricList">
              <div className="metricRow">
                <span>Turni senza fonti recuperate</span>
                <strong>{data?.messages?.no_source_turns ?? "—"}</strong>
              </div>
              <div className="metricRow">
                <span>Retrieval medio</span>
                <strong>
                  {data?.messages?.avg_retrieval_ms
                    ? data.messages.avg_retrieval_ms + " ms"
                    : "—"}
                </strong>
              </div>
              <div className="metricRow">
                <span>Operatori configurati</span>
                <strong>{userCount("OPERATOR")}</strong>
              </div>
              <div className="metricRow">
                <span>Amministratori</span>
                <strong>{userCount("ADMIN")}</strong>
              </div>
            </div>
          </section>
        </div>

        <section className="adminPanel recentPanel">
          <div className="panelTitle">Stato piattaforma</div>
          <div className="metricList">
            <div className="metricRow">
              <span>AI configurata</span>
              <strong>{health?.aiConfigured ? "Sì" : "No"}</strong>
            </div>
            <div className="metricRow">
              <span>Database raggiungibile</span>
              <strong>{health?.database?.reachable ? "Sì" : "No"}</strong>
            </div>
            <div className="metricRow">
              <span>Knowledge read-only</span>
              <strong>
                {health?.database?.knowledgeReadOnlyTransaction ? "Sì" : "No"}
              </strong>
            </div>
            <div className="metricRow">
              <span>Dati operativi Gemma</span>
              <strong>{health?.database?.gemmaSchemaReady ? "Pronti" : "Da verificare"}</strong>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

export default function AdminPage() {
  return (
    <GemmaInternalAuth requiredRole="ADMIN">
      {({ user, logout }) => (
        <AdminDashboardBody user={user} logout={logout} />
      )}
    </GemmaInternalAuth>
  );
}

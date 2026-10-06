"use client";

import { useEffect, useState } from "react";
import PortalNav from "../../components/PortalNav";

export default function AdminArea() {
  const [stats, setStats] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [health, setHealth] = useState(null);

  async function load() {
    const [statsResponse, ticketsResponse, healthResponse] = await Promise.all([
      fetch("/api/gemma/admin/stats", { cache: "no-store" }),
      fetch("/api/gemma/tickets?scope=all", { cache: "no-store" }),
      fetch("/api/health", { cache: "no-store" }),
    ]);

    setStats(await statsResponse.json());
    const ticketData = await ticketsResponse.json();
    setTickets(Array.isArray(ticketData.tickets) ? ticketData.tickets : []);
    setHealth(await healthResponse.json());
  }

  useEffect(() => {
    void load();
  }, []);

  const statusCount = Object.fromEntries(
    (stats?.ticketCounts || []).map((item) => [item.status, item.count]),
  );

  const openTickets = Object.entries(statusCount)
    .filter(([status]) => !["RESOLVED", "CLOSED"].includes(status))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);

  return (
    <main className="portalPage">
      <div className="portalTop">
        <div>
          <div className="brand">TAAP <span>Gemma</span></div>
          <h1>Admin</h1>
          <p>Controllo operativo della preview, performance e copertura.</p>
        </div>
        <PortalNav />
      </div>

      <section className="statGrid">
        <article className="statCard">
          <span>Conversazioni</span>
          <strong>{stats?.conversations?.conversations ?? "—"}</strong>
          <small>sessioni Gemma persistite</small>
        </article>
        <article className="statCard">
          <span>Ticket attivi</span>
          <strong>{stats ? openTickets : "—"}</strong>
          <small>esclusi risolti e chiusi</small>
        </article>
        <article className="statCard">
          <span>Tempo medio</span>
          <strong>
            {stats?.performance?.avg_total_ms
              ? stats.performance.avg_total_ms + " ms"
              : "—"}
          </strong>
          <small>{stats?.performance?.measured_turns || 0} turni misurati</small>
        </article>
        <article className="statCard">
          <span>Knowledge attiva</span>
          <strong>{stats?.knowledge?.active_documents ?? "—"}</strong>
          <small>{stats?.knowledge?.chunks ?? "—"} chunk</small>
        </article>
      </section>

      <div className="adminColumns">
        <section className="adminPanel">
          <div className="panelTitle">Coda per reparto</div>
          {(stats?.departments || []).length === 0 ? (
            <div className="emptyState">Nessun ticket attivo.</div>
          ) : (
            <div className="metricList">
              {(stats?.departments || []).map((item) => (
                <div className="metricRow" key={item.department}>
                  <span>{item.department}</span>
                  <strong>{item.count}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="adminPanel">
          <div className="panelTitle">Stato piattaforma</div>
          <div className="metricList">
            <div className="metricRow">
              <span>AI configurata</span>
              <strong>{health?.aiConfigured ? "Sì" : "No"}</strong>
            </div>
            <div className="metricRow">
              <span>DB raggiungibile</span>
              <strong>{health?.database?.reachable ? "Sì" : "No"}</strong>
            </div>
            <div className="metricRow">
              <span>Knowledge read-only</span>
              <strong>
                {health?.database?.knowledgeReadOnlyTransaction ? "Sì" : "No"}
              </strong>
            </div>
            <div className="metricRow">
              <span>Endpoint scrittura Lia/Alda</span>
              <strong>0</strong>
            </div>
          </div>
        </section>
      </div>

      <section className="adminPanel recentPanel">
        <div className="panelTitle">Ticket recenti</div>
        <div className="adminTable">
          <div className="adminTableHead">
            <span>Ticket</span>
            <span>Richiesta</span>
            <span>Reparto</span>
            <span>Stato</span>
            <span>Priorità</span>
          </div>
          {tickets.slice(0, 20).map((ticket) => (
            <div className="adminTableRow" key={ticket.id}>
              <span>#{ticket.number}</span>
              <span>{ticket.state_json?.issue || "Segnalazione"}</span>
              <span>{ticket.department || "OTHER"}</span>
              <span>{ticket.status}</span>
              <span>{ticket.priority}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

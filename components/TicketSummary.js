export default function TicketSummary({ ticket }) {
  const state = ticket?.state_json || ticket?.ticket || {};
  const facts = Array.isArray(state.facts) ? state.facts : [];
  const checks = Array.isArray(state.checks) ? state.checks : [];

  return (
    <section className="summaryCard">
      <div className="summaryTitle">Riepilogo dinamico Gemma</div>

      <div className="summarySection">
        <span className="summaryLabel">Problema o richiesta</span>
        <p>{state.issue || "Non ancora definito."}</p>
      </div>

      {facts.length > 0 && (
        <div className="summarySection">
          <span className="summaryLabel">Informazioni raccolte</span>
          <ul>
            {facts.map((item, index) => (
              <li key={(item.key || item.label || "") + index}>
                <strong>{item.label}:</strong> {item.value}
              </li>
            ))}
          </ul>
        </div>
      )}

      {checks.length > 0 && (
        <div className="summarySection">
          <span className="summaryLabel">Verifiche effettuate</span>
          <ul>
            {checks.map((item, index) => (
              <li key={(item.key || item.label || "") + index}>
                <strong>{item.label}:</strong> {item.value}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.outcome && (
        <div className="summarySection">
          <span className="summaryLabel">Esito</span>
          <p>{state.outcome}</p>
        </div>
      )}

      {state.pending && !state.resolved && (
        <div className="summarySection">
          <span className="summaryLabel">Punto in sospeso</span>
          <p>{state.pending}</p>
        </div>
      )}

      {state.department && (
        <div className="summarySection">
          <span className="summaryLabel">Destinazione</span>
          <p>{state.department}</p>
        </div>
      )}
    </section>
  );
}

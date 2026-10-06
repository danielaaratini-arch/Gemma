export const GEMMA_DEPARTMENTS = [
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

export const GEMMA_TICKET_STATUSES = [
  "OPEN",
  "TAKEN_IN_CHARGE",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_DEPARTMENT",
  "RESOLVED",
  "CLOSED",
];

export const GEMMA_PRIORITIES = ["LOW", "MEDIUM", "HIGH"];

export function emptyGemmaState() {
  return {
    issue: null,
    service: null,
    department: null,
    facts: [],
    checks: [],
    pending: null,
    outcome: null,
    resolved: false,
    ticketRecommended: false,
  };
}

function compact(value, max = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

function cleanList(value, maxItems, maxText) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      key: compact(item?.key, 80),
      label: compact(item?.label, 180),
      value: compact(item?.value ?? item?.result, maxText),
    }))
    .filter((item) => item.label && item.value)
    .slice(0, maxItems);
}

export function normalizeGemmaState(value) {
  const source = value && typeof value === "object" ? value : {};
  const department = GEMMA_DEPARTMENTS.includes(source.department)
    ? source.department
    : null;

  return {
    issue: compact(source.issue, 700),
    service: compact(source.service, 80),
    department,
    facts: cleanList(source.facts, 24, 500),
    checks: cleanList(source.checks, 36, 700),
    pending: compact(source.pending, 700),
    outcome: compact(source.outcome, 900),
    resolved: source.resolved === true,
    ticketRecommended: source.ticketRecommended === true,
  };
}

export function buildDynamicSummary(input) {
  const state = normalizeGemmaState(input);
  const lines = ["RIEPILOGO DINAMICO GEMMA", ""];

  lines.push("PROBLEMA O RICHIESTA");
  lines.push(state.issue || "Non ancora definito.");

  if (state.facts.length) {
    lines.push("", "INFORMAZIONI RACCOLTE");
    for (const item of state.facts) {
      lines.push("- " + item.label + ": " + item.value);
    }
  }

  if (state.checks.length) {
    lines.push("", "VERIFICHE EFFETTUATE");
    for (const item of state.checks) {
      lines.push("- " + item.label + ": " + item.value);
    }
  }

  if (state.outcome) {
    lines.push("", "ESITO");
    lines.push(state.outcome);
  }

  if (state.pending && !state.resolved) {
    lines.push("", "PUNTO IN SOSPESO");
    lines.push(state.pending);
  }

  if (state.department) {
    lines.push("", "DESTINAZIONE");
    lines.push(state.department);
  }

  return lines.join("\n");
}

export function publicTicketState(input) {
  const state = normalizeGemmaState(input);
  return {
    issue: state.issue,
    service: state.service,
    department: state.department,
    facts: state.facts,
    checks: state.checks,
    pending: state.pending,
    outcome: state.outcome,
    resolved: state.resolved,
    ticketRecommended: state.ticketRecommended,
    summary: buildDynamicSummary(state),
  };
}

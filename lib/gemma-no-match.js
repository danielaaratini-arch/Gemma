import { operationalDb } from "./db";
import { ensureGemmaSchema } from "./gemma-store";

function keyOf(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function listNoMatches(limit = 300) {
  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) throw new Error("Database non disponibile.");

  const rows = await sql.unsafe(
    "SELECT " +
      "m.id AS assistant_id,m.created_at,c.id AS conversation_id,c.title,c.customer_key,c.state_json," +
      "u.content AS question,t.number::text AS ticket_number " +
    "FROM gemma.message m " +
    "JOIN gemma.conversation c ON c.id=m.conversation_id " +
    "LEFT JOIN LATERAL (" +
      "SELECT content FROM gemma.message ux " +
      "WHERE ux.conversation_id=m.conversation_id AND ux.role='USER' AND ux.created_at<=m.created_at " +
      "ORDER BY ux.created_at DESC LIMIT 1" +
    ") u ON true " +
    "LEFT JOIN LATERAL (" +
      "SELECT number FROM gemma.ticket tx WHERE tx.conversation_id=c.id ORDER BY tx.created_at DESC LIMIT 1" +
    ") t ON true " +
    "WHERE m.role='GEMMA' AND coalesce((m.metadata_json->>'knowledgeHits')::int,0)=0 " +
    "ORDER BY m.created_at DESC LIMIT $1",
    [Math.max(1, Math.min(1000, Number(limit) || 300))],
  );

  const groups = new Map();

  for (const row of rows) {
    const question = String(row.question || "").trim();
    if (!question) continue;
    const key = keyOf(question);
    if (!key) continue;

    const state =
      row.state_json && typeof row.state_json === "object"
        ? row.state_json
        : {};

    const current = groups.get(key) || {
      key,
      question,
      count: 0,
      firstSeen: row.created_at,
      lastSeen: row.created_at,
      service: state.service || null,
      department: state.department || null,
      examples: [],
      ticketNumbers: [],
    };

    current.count += 1;

    if (new Date(row.created_at).getTime() > new Date(current.lastSeen).getTime()) {
      current.lastSeen = row.created_at;
      current.question = question;
      current.service = state.service || current.service;
      current.department = state.department || current.department;
    }

    if (new Date(row.created_at).getTime() < new Date(current.firstSeen).getTime()) {
      current.firstSeen = row.created_at;
    }

    if (current.examples.length < 4) {
      current.examples.push({
        conversationId: row.conversation_id,
        question,
        createdAt: row.created_at,
        ticketNumber: row.ticket_number || null,
      });
    }

    if (
      row.ticket_number &&
      !current.ticketNumbers.includes(row.ticket_number)
    ) {
      current.ticketNumbers.push(row.ticket_number);
    }

    groups.set(key, current);
  }

  return Array.from(groups.values()).sort(
    (left, right) =>
      right.count - left.count ||
      new Date(right.lastSeen).getTime() - new Date(left.lastSeen).getTime(),
  );
}

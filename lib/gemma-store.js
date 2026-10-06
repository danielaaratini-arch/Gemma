import postgres from "postgres";
import { randomUUID } from "node:crypto";
import {
  buildDynamicSummary,
  emptyGemmaState,
  GEMMA_DEPARTMENTS,
  GEMMA_PRIORITIES,
  GEMMA_TICKET_STATUSES,
  normalizeGemmaState,
} from "./gemma-summary";

let schemaPromise = null;

function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL non configurata.");
  return postgres(url, {
    max: 4,
    idle_timeout: 10,
    connect_timeout: 8,
    prepare: false,
  });
}

function jsonValue(value) {
  return JSON.stringify(value ?? {});
}

export async function ensureGemmaSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = database();
      try {
        await sql.begin("read write", async (tx) => {
          await tx.unsafe('CREATE SCHEMA IF NOT EXISTS gemma');

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.conversation (
              id TEXT PRIMARY KEY,
              customer_key TEXT NOT NULL,
              title TEXT,
              status TEXT NOT NULL DEFAULT 'ACTIVE',
              state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
              summary_text TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_conversation_customer_idx
            ON gemma.conversation(customer_key, updated_at DESC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.message (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL REFERENCES gemma.conversation(id) ON DELETE CASCADE,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              metadata_json JSONB,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_message_conversation_idx
            ON gemma.message(conversation_id, created_at ASC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.ticket (
              id TEXT PRIMARY KEY,
              number BIGSERIAL UNIQUE NOT NULL,
              conversation_id TEXT REFERENCES gemma.conversation(id) ON DELETE SET NULL,
              customer_key TEXT NOT NULL,
              customer_name TEXT NOT NULL DEFAULT 'Cliente Demo',
              status TEXT NOT NULL DEFAULT 'OPEN',
              priority TEXT NOT NULL DEFAULT 'MEDIUM',
              department TEXT,
              assignee TEXT,
              summary_snapshot TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_ticket_queue_idx
            ON gemma.ticket(status, department, updated_at DESC)
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_ticket_customer_idx
            ON gemma.ticket(customer_key, updated_at DESC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.ticket_message (
              id TEXT PRIMARY KEY,
              ticket_id TEXT NOT NULL REFERENCES gemma.ticket(id) ON DELETE CASCADE,
              role TEXT NOT NULL,
              author_name TEXT,
              content TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_ticket_message_idx
            ON gemma.ticket_message(ticket_id, created_at ASC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.ticket_note (
              id TEXT PRIMARY KEY,
              ticket_id TEXT NOT NULL REFERENCES gemma.ticket(id) ON DELETE CASCADE,
              author_name TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.ticket_event (
              id TEXT PRIMARY KEY,
              ticket_id TEXT NOT NULL REFERENCES gemma.ticket(id) ON DELETE CASCADE,
              type TEXT NOT NULL,
              description TEXT NOT NULL,
              actor_name TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);
        });
      } finally {
        await sql.end({ timeout: 1 }).catch(() => {});
      }
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

export function customerKeyFromRequest(request) {
  const fromCookie = request?.cookies?.get?.("gemma_customer")?.value;
  if (fromCookie) return { key: fromCookie, isNew: false };
  return { key: randomUUID(), isNew: true };
}

export function customerCookie(key) {
  return [
    "gemma_customer=" + encodeURIComponent(key),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=2592000",
    process.env.VERCEL ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export async function getConversation(conversationId, customerKey) {
  await ensureGemmaSchema();
  if (!conversationId) return null;
  const sql = database();
  try {
    const rows = await sql`
      SELECT id, customer_key, title, status, state_json, summary_text,
             created_at, updated_at
      FROM gemma.conversation
      WHERE id = ${conversationId} AND customer_key = ${customerKey}
      LIMIT 1
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function createConversation(customerKey, firstQuestion) {
  await ensureGemmaSchema();
  const sql = database();
  const id = randomUUID();
  const title = String(firstQuestion || "Nuova conversazione").trim().slice(0, 100);
  const state = emptyGemmaState();

  try {
    const rows = await sql`
      INSERT INTO gemma.conversation
        (id, customer_key, title, state_json, summary_text)
      VALUES
        (${id}, ${customerKey}, ${title}, ${jsonValue(state)}::jsonb, ${buildDynamicSummary(state)})
      RETURNING *
    `;
    return rows[0];
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function saveConversationTurn({
  conversationId,
  userText,
  assistantText,
  state,
  metrics,
}) {
  await ensureGemmaSchema();
  const normalized = normalizeGemmaState(state);
  const summary = buildDynamicSummary(normalized);
  const sql = database();

  try {
    await sql.begin("read write", async (tx) => {
      await tx`
        INSERT INTO gemma.message (id, conversation_id, role, content, metadata_json)
        VALUES (
          ${randomUUID()},
          ${conversationId},
          'USER',
          ${userText},
          NULL
        )
      `;

      await tx`
        INSERT INTO gemma.message (id, conversation_id, role, content, metadata_json)
        VALUES (
          ${randomUUID()},
          ${conversationId},
          'GEMMA',
          ${assistantText},
          ${jsonValue(metrics)}::jsonb
        )
      `;

      await tx`
        UPDATE gemma.conversation
        SET state_json = ${jsonValue(normalized)}::jsonb,
            summary_text = ${summary},
            updated_at = now()
        WHERE id = ${conversationId}
      `;
    });

    return { state: normalized, summary };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function createTicket({ conversationId, customerKey, customerName }) {
  await ensureGemmaSchema();
  const sql = database();

  try {
    return await sql.begin("read write", async (tx) => {
      const conversations = await tx`
        SELECT id, state_json, summary_text
        FROM gemma.conversation
        WHERE id = ${conversationId} AND customer_key = ${customerKey}
        LIMIT 1
      `;

      const conversation = conversations[0];
      if (!conversation) throw new Error("Conversazione non trovata.");

      const existing = await tx`
        SELECT *
        FROM gemma.ticket
        WHERE conversation_id = ${conversationId}
          AND status <> 'CLOSED'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (existing[0]) return existing[0];

      const state = normalizeGemmaState(conversation.state_json);
      const department = state.department || "OTHER";
      const id = randomUUID();
      const summary = conversation.summary_text || buildDynamicSummary(state);

      const rows = await tx`
        INSERT INTO gemma.ticket (
          id, conversation_id, customer_key, customer_name,
          status, priority, department, summary_snapshot
        )
        VALUES (
          ${id}, ${conversationId}, ${customerKey},
          ${String(customerName || "Cliente Demo").slice(0, 120)},
          'OPEN', 'MEDIUM', ${department}, ${summary}
        )
        RETURNING *
      `;

      await tx`
        INSERT INTO gemma.ticket_event
          (id, ticket_id, type, description, actor_name)
        VALUES
          (${randomUUID()}, ${id}, 'CREATED', 'Segnalazione aperta da Gemma.', 'Gemma')
      `;

      return rows[0];
    });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

function ticketProjection() {
  return `
    t.id, t.number::text AS number, t.conversation_id, t.customer_key,
    t.customer_name, t.status, t.priority, t.department, t.assignee,
    t.summary_snapshot, t.created_at, t.updated_at,
    c.state_json, c.summary_text
  `;
}

export async function listTickets({ customerKey = null } = {}) {
  await ensureGemmaSchema();
  const sql = database();
  try {
    const rows = customerKey
      ? await sql.unsafe(
          `SELECT ${ticketProjection()}
           FROM gemma.ticket t
           LEFT JOIN gemma.conversation c ON c.id = t.conversation_id
           WHERE t.customer_key = $1
           ORDER BY t.updated_at DESC`,
          [customerKey],
        )
      : await sql.unsafe(
          `SELECT ${ticketProjection()}
           FROM gemma.ticket t
           LEFT JOIN gemma.conversation c ON c.id = t.conversation_id
           ORDER BY
             CASE WHEN t.status IN ('OPEN','TAKEN_IN_CHARGE','IN_PROGRESS') THEN 0 ELSE 1 END,
             t.updated_at DESC
           LIMIT 250`,
        );

    return rows.map((row) => ({
      ...row,
      dynamic_summary: row.summary_text || row.summary_snapshot,
      state_json: normalizeGemmaState(row.state_json),
    }));
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function getTicket(ticketId, customerKey = null) {
  await ensureGemmaSchema();
  const sql = database();

  try {
    const tickets = customerKey
      ? await sql.unsafe(
          `SELECT ${ticketProjection()}
           FROM gemma.ticket t
           LEFT JOIN gemma.conversation c ON c.id = t.conversation_id
           WHERE t.id = $1 AND t.customer_key = $2
           LIMIT 1`,
          [ticketId, customerKey],
        )
      : await sql.unsafe(
          `SELECT ${ticketProjection()}
           FROM gemma.ticket t
           LEFT JOIN gemma.conversation c ON c.id = t.conversation_id
           WHERE t.id = $1
           LIMIT 1`,
          [ticketId],
        );

    const ticket = tickets[0];
    if (!ticket) return null;

    const [conversationMessages, ticketMessages, notes, events] = await Promise.all([
      ticket.conversation_id
        ? sql`
            SELECT id, role, content, metadata_json, created_at
            FROM gemma.message
            WHERE conversation_id = ${ticket.conversation_id}
            ORDER BY created_at ASC
          `
        : Promise.resolve([]),
      sql`
        SELECT id, role, author_name, content, created_at
        FROM gemma.ticket_message
        WHERE ticket_id = ${ticketId}
        ORDER BY created_at ASC
      `,
      customerKey
        ? Promise.resolve([])
        : sql`
            SELECT id, author_name, content, created_at
            FROM gemma.ticket_note
            WHERE ticket_id = ${ticketId}
            ORDER BY created_at DESC
          `,
      sql`
        SELECT id, type, description, actor_name, created_at
        FROM gemma.ticket_event
        WHERE ticket_id = ${ticketId}
        ORDER BY created_at DESC
      `,
    ]);

    return {
      ...ticket,
      dynamic_summary: ticket.summary_text || ticket.summary_snapshot,
      state_json: normalizeGemmaState(ticket.state_json),
      conversationMessages,
      ticketMessages,
      notes,
      events,
    };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function updateTicket(ticketId, patch, actor = "Operatore Demo") {
  await ensureGemmaSchema();
  const sql = database();

  const status = GEMMA_TICKET_STATUSES.includes(patch.status) ? patch.status : null;
  const priority = GEMMA_PRIORITIES.includes(patch.priority) ? patch.priority : null;
  const department = GEMMA_DEPARTMENTS.includes(patch.department) ? patch.department : null;
  const assignee = typeof patch.assignee === "string" ? patch.assignee.trim().slice(0, 120) : null;

  try {
    return await sql.begin("read write", async (tx) => {
      const beforeRows = await tx`
        SELECT * FROM gemma.ticket WHERE id = ${ticketId} LIMIT 1
      `;
      const before = beforeRows[0];
      if (!before) return null;

      const nextStatus = status || before.status;
      const nextPriority = priority || before.priority;
      const nextDepartment = department || before.department;
      const nextAssignee = patch.assignee !== undefined ? assignee : before.assignee;

      const rows = await tx`
        UPDATE gemma.ticket
        SET status = ${nextStatus},
            priority = ${nextPriority},
            department = ${nextDepartment},
            assignee = ${nextAssignee},
            updated_at = now()
        WHERE id = ${ticketId}
        RETURNING *
      `;

      const changes = [];
      if (nextStatus !== before.status) changes.push("Stato: " + before.status + " → " + nextStatus);
      if (nextPriority !== before.priority) changes.push("Priorità: " + before.priority + " → " + nextPriority);
      if (nextDepartment !== before.department) changes.push("Reparto: " + (before.department || "-") + " → " + nextDepartment);
      if (nextAssignee !== before.assignee) changes.push("Assegnatario: " + (before.assignee || "-") + " → " + (nextAssignee || "-"));

      if (changes.length) {
        await tx`
          INSERT INTO gemma.ticket_event
            (id, ticket_id, type, description, actor_name)
          VALUES
            (${randomUUID()}, ${ticketId}, 'UPDATED', ${changes.join("; ")}, ${actor})
        `;
      }

      return rows[0];
    });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function addTicketMessage({ ticketId, role, authorName, content, customerKey = null }) {
  await ensureGemmaSchema();
  const text = String(content || "").trim().slice(0, 6000);
  if (!text) throw new Error("Messaggio vuoto.");

  const sql = database();
  try {
    return await sql.begin("read write", async (tx) => {
      const ticketRows = customerKey
        ? await tx`
            SELECT id FROM gemma.ticket
            WHERE id = ${ticketId} AND customer_key = ${customerKey}
            LIMIT 1
          `
        : await tx`
            SELECT id FROM gemma.ticket WHERE id = ${ticketId} LIMIT 1
          `;

      if (!ticketRows[0]) return null;

      const rows = await tx`
        INSERT INTO gemma.ticket_message
          (id, ticket_id, role, author_name, content)
        VALUES
          (${randomUUID()}, ${ticketId}, ${role},
           ${String(authorName || "").slice(0, 120) || null}, ${text})
        RETURNING *
      `;

      await tx`
        UPDATE gemma.ticket SET updated_at = now() WHERE id = ${ticketId}
      `;

      await tx`
        INSERT INTO gemma.ticket_event
          (id, ticket_id, type, description, actor_name)
        VALUES
          (${randomUUID()}, ${ticketId}, 'MESSAGE',
           ${role === "CUSTOMER" ? "Nuovo messaggio del cliente." : "Risposta del backoffice."},
           ${String(authorName || (role === "CUSTOMER" ? "Cliente" : "Operatore"))})
      `;

      return rows[0];
    });
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function addTicketNote({ ticketId, authorName, content }) {
  await ensureGemmaSchema();
  const text = String(content || "").trim().slice(0, 6000);
  if (!text) throw new Error("Nota vuota.");

  const sql = database();
  try {
    const rows = await sql`
      INSERT INTO gemma.ticket_note
        (id, ticket_id, author_name, content)
      VALUES
        (${randomUUID()}, ${ticketId}, ${String(authorName || "Operatore Demo").slice(0, 120)}, ${text})
      RETURNING *
    `;

    await sql`
      INSERT INTO gemma.ticket_event
        (id, ticket_id, type, description, actor_name)
      VALUES
        (${randomUUID()}, ${ticketId}, 'NOTE', 'Nota interna aggiunta.', ${String(authorName || "Operatore Demo").slice(0, 120)})
    `;

    return rows[0] ?? null;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function adminStats() {
  await ensureGemmaSchema();
  const sql = database();
  try {
    const [ticketCounts, departments, conversationCounts, performance, knowledge] = await Promise.all([
      sql`
        SELECT status, count(*)::int AS count
        FROM gemma.ticket
        GROUP BY status
      `,
      sql`
        SELECT coalesce(department, 'OTHER') AS department, count(*)::int AS count
        FROM gemma.ticket
        WHERE status NOT IN ('RESOLVED','CLOSED')
        GROUP BY coalesce(department, 'OTHER')
        ORDER BY count DESC
      `,
      sql`
        SELECT count(*)::int AS conversations,
               count(*) FILTER (WHERE (state_json->>'ticketRecommended')::boolean = true)::int AS ticket_recommended
        FROM gemma.conversation
      `,
      sql`
        SELECT
          round(avg((metadata_json->>'totalMs')::numeric))::int AS avg_total_ms,
          round(avg((metadata_json->>'retrievalMs')::numeric))::int AS avg_retrieval_ms,
          count(*)::int AS measured_turns
        FROM gemma.message
        WHERE role = 'GEMMA'
          AND metadata_json ? 'totalMs'
      `,
      sql`
        SELECT
          count(*) FILTER (WHERE "status" = 'ACTIVE')::int AS active_documents,
          (SELECT count(*)::int FROM "KnowledgeChunk") AS chunks
        FROM "KnowledgeDocument"
      `,
    ]);

    return {
      ticketCounts,
      departments,
      conversations: conversationCounts[0] || {},
      performance: performance[0] || {},
      knowledge: knowledge[0] || {},
    };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

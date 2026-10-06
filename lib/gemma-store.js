import { createHash, randomUUID } from "node:crypto";
import { operationalDb } from "./db";
import {
  deleteGemmaBlob,
  gemmaBlobConfigured,
  parseGemmaBlobPointer,
  readGemmaBlob,
  saveGemmaBlob,
} from "./gemma-blob";
import {
  readAuthSession,
  userCustomerKey,
} from "./gemma-session-token";
import {
  buildDynamicSummary,
  emptyGemmaState,
  GEMMA_DEPARTMENTS,
  GEMMA_PRIORITIES,
  GEMMA_TICKET_STATUSES,
  normalizeGemmaState,
} from "./gemma-summary";

let schemaPromise = null;

function jsonValue(value) {
  return JSON.stringify(value ?? {});
}

export async function ensureGemmaSchema() {
  const productionNoAutoMigrate =
    process.env.VERCEL_ENV === "production" &&
    String(process.env.GEMMA_AUTO_MIGRATE || "").toLowerCase() !== "true";

  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = operationalDb();
      if (!sql) throw new Error("DATABASE_URL non configurata.");

      if (productionNoAutoMigrate) {
        const rows = await sql.unsafe(
          "SELECT " +
            "to_regclass('gemma.conversation') IS NOT NULL AS conversation," +
            "to_regclass('gemma.ticket') IS NOT NULL AS ticket," +
            "to_regclass('gemma.user_account') IS NOT NULL AS users," +
            "to_regclass('gemma.push_subscription') IS NOT NULL AS push_subscriptions," +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gemma' AND table_name='ticket_attachment' AND column_name='blob_path') AS attachment_blob_path," +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gemma' AND table_name='user_account' AND column_name='email_verified') AS email_verified," +
            "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='gemma' AND table_name='ticket' AND column_name='customer_code') AS ticket_customer_code",
        );

        if (
          rows[0]?.conversation !== true ||
          rows[0]?.ticket !== true ||
          rows[0]?.users !== true ||
          rows[0]?.push_subscriptions !== true ||
          rows[0]?.attachment_blob_path !== true ||
          rows[0]?.email_verified !== true ||
          rows[0]?.ticket_customer_code !== true
        ) {
          throw new Error(
            "Schema Gemma non aggiornato. Esegui npm run migrate:gemma prima della production.",
          );
        }

        return true;
      }

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
              request_key TEXT,
              notification_email TEXT,
              notification_email_verified BOOLEAN NOT NULL DEFAULT false,
              customer_code TEXT,
              service_number TEXT,
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
            ALTER TABLE gemma.ticket
            ADD COLUMN IF NOT EXISTS request_key TEXT
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.ticket
            ADD COLUMN IF NOT EXISTS notification_email TEXT
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.ticket
            ADD COLUMN IF NOT EXISTS notification_email_verified BOOLEAN NOT NULL DEFAULT false
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.ticket
            ADD COLUMN IF NOT EXISTS customer_code TEXT
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.ticket
            ADD COLUMN IF NOT EXISTS service_number TEXT
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.ticket_attachment (
              id TEXT PRIMARY KEY,
              ticket_id TEXT NOT NULL REFERENCES gemma.ticket(id) ON DELETE CASCADE,
              original_name TEXT NOT NULL,
              content_type TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              content BYTEA,
              blob_path TEXT,
              uploaded_by TEXT NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);


          await tx.unsafe(`
            ALTER TABLE gemma.ticket_attachment
            ADD COLUMN IF NOT EXISTS blob_path TEXT
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.ticket_attachment
            ALTER COLUMN content DROP NOT NULL
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_ticket_attachment_ticket_idx
            ON gemma.ticket_attachment(ticket_id, created_at ASC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.ticket_notification (
              id TEXT PRIMARY KEY,
              ticket_id TEXT NOT NULL REFERENCES gemma.ticket(id) ON DELETE CASCADE,
              event TEXT NOT NULL,
              recipient TEXT NOT NULL,
              status TEXT NOT NULL,
              detail TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.user_account (
              id TEXT PRIMARY KEY,
              email TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL CHECK (role IN ('ADMIN','OPERATOR','CUSTOMER')),
              active BOOLEAN NOT NULL DEFAULT true,
              customer_code TEXT,
              service_number TEXT,
              email_verified BOOLEAN NOT NULL DEFAULT false,
              email_verification_token_hash TEXT,
              email_verification_expires_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              last_login_at TIMESTAMPTZ
            )
          `);


          await tx.unsafe(`
            ALTER TABLE gemma.user_account
            ADD COLUMN IF NOT EXISTS customer_code TEXT
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.user_account
            ADD COLUMN IF NOT EXISTS service_number TEXT
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.user_account
            ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.user_account
            ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT
          `);

          await tx.unsafe(`
            ALTER TABLE gemma.user_account
            ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_user_role_idx
            ON gemma.user_account(role, active, name)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.push_subscription (
              id TEXT PRIMARY KEY,
              customer_key TEXT NOT NULL,
              endpoint TEXT UNIQUE NOT NULL,
              p256dh TEXT NOT NULL,
              auth TEXT NOT NULL,
              user_agent TEXT,
              active BOOLEAN NOT NULL DEFAULT true,
              failure_count INTEGER NOT NULL DEFAULT 0,
              last_success_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_push_subscription_customer_idx
            ON gemma.push_subscription(customer_key, active, updated_at DESC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.service_fault (
              id TEXT PRIMARY KEY,
              service TEXT NOT NULL,
              fault_type TEXT NOT NULL,
              city TEXT,
              match_description TEXT NOT NULL,
              message TEXT NOT NULL,
              active BOOLEAN NOT NULL DEFAULT true,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_fault_active_idx
            ON gemma.service_fault(active, service, updated_at DESC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.customer_memory (
              id TEXT PRIMARY KEY,
              customer_key TEXT NOT NULL,
              value TEXT NOT NULL,
              source TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_customer_memory_idx
            ON gemma.customer_memory(customer_key, updated_at DESC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.ticket_rating (
              id TEXT PRIMARY KEY,
              ticket_id TEXT UNIQUE NOT NULL REFERENCES gemma.ticket(id) ON DELETE CASCADE,
              score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
              comment TEXT,
              operator_name TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);

          await tx.unsafe(`
            CREATE UNIQUE INDEX IF NOT EXISTS gemma_ticket_request_key_idx
            ON gemma.ticket(request_key)
            WHERE request_key IS NOT NULL
          `);

          await tx.unsafe(`
            CREATE INDEX IF NOT EXISTS gemma_ticket_updated_idx
            ON gemma.ticket(updated_at DESC, id DESC)
          `);

          await tx.unsafe(`
            CREATE TABLE IF NOT EXISTS gemma.rate_limit (
              rate_key TEXT PRIMARY KEY,
              bucket BIGINT NOT NULL,
              request_count INTEGER NOT NULL DEFAULT 0,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
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
        // pooled connection stays open for reuse
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
  const auth = readAuthSession(request);

  if (auth?.role === "CUSTOMER") {
    return {
      key: userCustomerKey(auth),
      isNew: false,
      authenticated: true,
      user: auth,
    };
  }

  const fromCookie = request?.cookies?.get?.("gemma_customer")?.value;
  if (fromCookie) {
    return {
      key: fromCookie,
      isNew: false,
      authenticated: false,
      user: null,
    };
  }

  return {
    key: randomUUID(),
    isNew: true,
    authenticated: false,
    user: null,
  };
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
  const sql = operationalDb();
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
    // pooled connection stays open for reuse
  }
}

export async function createConversation(customerKey, firstQuestion) {
  await ensureGemmaSchema();
  const sql = operationalDb();
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
    // pooled connection stays open for reuse
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
  const sql = operationalDb();

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
    // pooled connection stays open for reuse
  }
}

export async function createTicket({
  conversationId,
  customerKey,
  customerName,
  customerCode = null,
  serviceNumber = null,
  requestKey,
  notificationEmail,
  notificationEmailVerified = false,
}) {
  await ensureGemmaSchema();
  const sql = operationalDb();

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

      const state = normalizeGemmaState(conversation.state_json);
      if (!state.department) {
        throw new Error(
          "Gemma non ha ancora determinato il reparto corretto per la segnalazione.",
        );
      }
      const department = state.department;
      const id = randomUUID();
      const summary = conversation.summary_text || buildDynamicSummary(state);
      const idempotencyKey = String(requestKey || randomUUID()).slice(0, 120);

      const rows = await tx`
        INSERT INTO gemma.ticket (
          id, conversation_id, customer_key, customer_name,
          customer_code, service_number,
          status, priority, department, request_key,
          notification_email, notification_email_verified, summary_snapshot
        )
        VALUES (
          ${id}, ${conversationId}, ${customerKey},
          ${String(customerName || "Cliente Demo").slice(0, 120)},
          ${String(customerCode || "").trim().slice(0, 80) || null},
          ${String(serviceNumber || "").trim().slice(0, 80) || null},
          'OPEN', 'MEDIUM', ${department}, ${idempotencyKey},
          ${String(notificationEmail || "").trim().toLowerCase() || null},
          ${notificationEmailVerified === true},
          ${summary}
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `;

      if (!rows[0]) {
        const duplicates = await tx`
          SELECT *
          FROM gemma.ticket
          WHERE request_key = ${idempotencyKey}
          LIMIT 1
        `;
        return duplicates[0] ?? null;
      }

      await tx`
        INSERT INTO gemma.ticket_event
          (id, ticket_id, type, description, actor_name)
        VALUES
          (${randomUUID()}, ${id}, 'CREATED', 'Segnalazione aperta da Gemma.', 'Gemma')
      `;

      return rows[0];
    });
  } finally {
    // pooled connection stays open for reuse
  }
}

function ticketProjection() {
  return `
    t.id, t.number::text AS number, t.conversation_id, t.customer_key,
    t.customer_name, t.customer_code, t.service_number,
    t.status, t.priority, t.department, t.assignee,
    t.notification_email, t.notification_email_verified,
    t.summary_snapshot, t.created_at, t.updated_at,
    c.state_json, c.summary_text
  `;
}

export async function listTickets({ customerKey = null, limit = 50, cursor = null, search = "", status = "ALL", department = "ALL", assignee = "" } = {}) {
  await ensureGemmaSchema();
  const sql = operationalDb();
  try {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const cursorUpdatedAt = cursor?.updatedAt || null;
    const cursorId = cursor?.id || null;

    const rows = customerKey
      ? await sql.unsafe(
          `SELECT ${ticketProjection()}
           FROM gemma.ticket t
           LEFT JOIN gemma.conversation c ON c.id = t.conversation_id
           WHERE t.customer_key = $1
             AND (
               $2::timestamptz IS NULL
               OR (t.updated_at, t.id) < ($2::timestamptz, $3::text)
             )
           ORDER BY t.updated_at DESC, t.id DESC
           LIMIT $4`,
          [customerKey, cursorUpdatedAt, cursorId, safeLimit],
        )
      : await sql.unsafe(
          `SELECT ${ticketProjection()}
           FROM gemma.ticket t
           LEFT JOIN gemma.conversation c ON c.id = t.conversation_id
           WHERE (
             $1::timestamptz IS NULL
             OR (t.updated_at, t.id) < ($1::timestamptz, $2::text)
           )
             AND (
               $3::text = ''
               OR t.number::text ILIKE '%' || $3 || '%'
               OR lower(coalesce(t.customer_name,'')) LIKE '%' || lower($3) || '%'
               OR lower(coalesce(t.notification_email,'')) LIKE '%' || lower($3) || '%'
               OR lower(coalesce(t.customer_code,'')) LIKE '%' || lower($3) || '%'
               OR lower(coalesce(t.service_number,'')) LIKE '%' || lower($3) || '%'
               OR lower(coalesce(c.title,'')) LIKE '%' || lower($3) || '%'
             )
             AND (
               $4::text = 'ALL'
               OR ($4::text = 'ACTIVE' AND t.status <> 'CLOSED')
               OR t.status = $4
             )
             AND (
               $5::text = 'ALL'
               OR ($5::text = 'UNASSIGNED' AND coalesce(t.department,'') = '')
               OR coalesce(t.department,'OTHER') = $5
             )
             AND (
               $6::text = ''
               OR lower(coalesce(t.assignee,'')) = lower($6)
             )
           ORDER BY t.updated_at DESC, t.id DESC
           LIMIT $7`,
          [
            cursorUpdatedAt,
            cursorId,
            String(search || '').trim(),
            String(status || 'ALL').toUpperCase(),
            String(department || 'ALL').toUpperCase(),
            String(assignee || '').trim(),
            safeLimit,
          ],
        );

    return rows.map((row) => ({
      ...row,
      dynamic_summary: row.summary_text || row.summary_snapshot,
      state_json: normalizeGemmaState(row.state_json),
    }));
  } finally {
    // pooled connection stays open for reuse
  }
}

export async function getTicket(ticketId, customerKey = null) {
  await ensureGemmaSchema();
  const sql = operationalDb();

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

    const attachments = await sql`
      SELECT id, original_name, content_type, size_bytes, uploaded_by, created_at
      FROM gemma.ticket_attachment
      WHERE ticket_id = ${ticketId}
      ORDER BY created_at ASC
    `;

    return {
      ...ticket,
      dynamic_summary: ticket.summary_text || ticket.summary_snapshot,
      state_json: normalizeGemmaState(ticket.state_json),
      conversationMessages,
      ticketMessages,
      notes,
      events,
      attachments: attachments.map((item) => ({
        ...item,
        url: "/api/gemma/files/" + item.id,
      })),
    };
  } finally {
    // pooled connection stays open for reuse
  }
}

export async function updateTicket(ticketId, patch, actor = "Operatore Demo") {
  await ensureGemmaSchema();
  const sql = operationalDb();

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
    // pooled connection stays open for reuse
  }
}

export async function addTicketMessage({ ticketId, role, authorName, content, customerKey = null }) {
  await ensureGemmaSchema();
  const text = String(content || "").trim().slice(0, 6000);
  if (!text) throw new Error("Messaggio vuoto.");

  const sql = operationalDb();
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
    // pooled connection stays open for reuse
  }
}

export async function addTicketNote({ ticketId, authorName, content }) {
  await ensureGemmaSchema();
  const text = String(content || "").trim().slice(0, 6000);
  if (!text) throw new Error("Nota vuota.");

  const sql = operationalDb();
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
    // pooled connection stays open for reuse
  }
}

export async function adminStats() {
  await ensureGemmaSchema();
  const sql = operationalDb();
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
    // pooled connection stays open for reuse
  }
}


export async function consumeAiRateLimit(rateKey, options = {}) {
  await ensureGemmaSchema();

  const limit = Math.max(1, Math.min(120, Number(options.limit) || 30));
  const windowSeconds = Math.max(
    10,
    Math.min(3600, Number(options.windowSeconds) || 60),
  );
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const hashedKey = createHash("sha256")
    .update(String(rateKey || "anonymous"))
    .digest("hex")
    .slice(0, 40);
  const sql = operationalDb();

  if (!sql) {
    return { allowed: false, remaining: 0, retryAfter: windowSeconds };
  }

  const rows = await sql.unsafe(
    `INSERT INTO gemma.rate_limit
      (rate_key, bucket, request_count, updated_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (rate_key)
     DO UPDATE SET
       bucket = EXCLUDED.bucket,
       request_count = CASE
         WHEN gemma.rate_limit.bucket = EXCLUDED.bucket
           THEN gemma.rate_limit.request_count + 1
         ELSE 1
       END,
       updated_at = now()
     RETURNING request_count`,
    [hashedKey, bucket],
  );

  const count = Number(rows[0]?.request_count || 1);

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: windowSeconds,
  };
}


export async function addTicketAttachments({
  ticketId,
  customerKey = null,
  files,
  actorName = "Cliente",
}) {
  const blobEnabled = gemmaBlobConfigured();
  const dbFallbackAllowed =
    String(process.env.GEMMA_ALLOW_DB_ATTACHMENTS || "").toLowerCase() === "true";

  if (
    process.env.VERCEL_ENV === "production" &&
    !blobEnabled &&
    !dbFallbackAllowed
  ) {
    throw new Error(
      "Storage allegati production non configurato: collega uno storage Blob privato prima di abilitare gli upload.",
    );
  }

  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) throw new Error("Database non disponibile.");

  const uploadedBlobPaths = [];

  try {
    return await sql.begin("read write", async (tx) => {
    const ticketRows = customerKey
      ? await tx`
          SELECT id FROM gemma.ticket
          WHERE id = ${ticketId} AND customer_key = ${customerKey}
          LIMIT 1
        `
      : await tx`
          SELECT id FROM gemma.ticket
          WHERE id = ${ticketId}
          LIMIT 1
        `;

    if (!ticketRows[0]) return null;

    const totals = await tx`
      SELECT coalesce(sum(size_bytes), 0)::bigint AS total
      FROM gemma.ticket_attachment
      WHERE ticket_id = ${ticketId}
    `;

    const existingTotal = Number(totals[0]?.total || 0);
    const incomingTotal = files.reduce(
      (sum, file) => sum + Number(file.size || 0),
      0,
    );

    if (existingTotal + incomingTotal > 10 * 1024 * 1024) {
      throw new Error("Gli allegati del ticket supererebbero il limite complessivo di 10 MB.");
    }

    const saved = [];

    for (const file of files) {
      const id = randomUUID();
      const blob = blobEnabled
        ? await saveGemmaBlob({
            ticketId,
            attachmentId: id,
            buffer: file.buffer,
            contentType: file.type || "application/octet-stream",
          })
        : null;

      if (blob?.pathname) uploadedBlobPaths.push(blob.pathname);

      const rows = await tx.unsafe(
        "INSERT INTO gemma.ticket_attachment " +
          "(id,ticket_id,original_name,content_type,size_bytes,content,blob_path,uploaded_by,created_at) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) " +
          "RETURNING id,original_name,content_type,size_bytes,blob_path,uploaded_by,created_at",
        [
          id,
          ticketId,
          String(file.name).slice(0, 255),
          String(file.type || "application/octet-stream").slice(0, 150),
          Number(file.size || 0),
          blob ? null : Buffer.from(file.buffer),
          blob?.pathname || null,
          String(actorName || "Cliente").slice(0, 120),
        ],
      );
      saved.push({
        ...rows[0],
        url: "/api/gemma/files/" + id,
      });

      await tx`
        INSERT INTO gemma.ticket_event
          (id, ticket_id, type, description, actor_name)
        VALUES
          (
            ${randomUUID()},
            ${ticketId},
            'ATTACHMENT_ADDED',
            ${"Documento allegato: " + String(file.name).slice(0, 255)},
            ${String(actorName || "Cliente").slice(0, 120)}
          )
      `;
    }

    await tx`
      UPDATE gemma.ticket
      SET updated_at = now()
      WHERE id = ${ticketId}
    `;

    return saved;
    });
  } catch (error) {
    await Promise.all(
      uploadedBlobPaths.map((pathname) =>
        deleteGemmaBlob(pathname).catch(() => {}),
      ),
    );
    throw error;
  }
}

export async function getTicketAttachment(attachmentId, customerKey = null) {
  await ensureGemmaSchema();
  const sql = operationalDb();
  if (!sql) return null;

  const rows = customerKey
    ? await sql.unsafe(
        "SELECT a.id,a.ticket_id,a.original_name,a.content_type,a.size_bytes,a.content,a.blob_path,t.customer_key FROM gemma.ticket_attachment a JOIN gemma.ticket t ON t.id=a.ticket_id WHERE a.id=$1 AND t.customer_key=$2 LIMIT 1",
        [attachmentId, customerKey],
      )
    : await sql.unsafe(
        "SELECT a.id,a.ticket_id,a.original_name,a.content_type,a.size_bytes,a.content,a.blob_path,t.customer_key FROM gemma.ticket_attachment a JOIN gemma.ticket t ON t.id=a.ticket_id WHERE a.id=$1 LIMIT 1",
        [attachmentId],
      );

  const file = rows[0] ?? null;
  if (!file) return null;

  const blobPath =
    String(file.blob_path || "").trim() ||
    parseGemmaBlobPointer(file.content);

  if (blobPath) {
    file.content = await readGemmaBlob(blobPath);
  }

  if (!file.content) {
    throw new Error("Contenuto allegato non disponibile.");
  }

  return file;
}

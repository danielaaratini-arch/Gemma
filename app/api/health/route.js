import postgres from "postgres";
import { ensureGemmaSchema } from "../../../lib/gemma-store";

export const runtime = "nodejs";

export async function GET() {
  let database = {
    configured: Boolean(process.env.DATABASE_URL),
    reachable: false,
    knowledgeReadOnlyTransaction: false,
    gemmaSchemaReady: false,
  };

  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
    });

    try {
      await ensureGemmaSchema();

      const readOnly = await sql.begin("read only", async (tx) => {
        const rows = await tx`
          SELECT current_setting('transaction_read_only') AS mode
        `;
        return rows[0]?.mode === "on";
      });

      const schemaRows = await sql`
        SELECT
          to_regclass('gemma.conversation') IS NOT NULL AS conversation,
          to_regclass('gemma.ticket') IS NOT NULL AS ticket
      `;

      database = {
        configured: true,
        reachable: true,
        knowledgeReadOnlyTransaction: readOnly,
        gemmaSchemaReady:
          schemaRows[0]?.conversation === true &&
          schemaRows[0]?.ticket === true,
      };
    } catch (error) {
      console.error("Gemma health DB error", error);
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }

  return Response.json({
    ok:
      Boolean(process.env.OPENAI_API_KEY) &&
      database.reachable &&
      database.knowledgeReadOnlyTransaction &&
      database.gemmaSchemaReady,
    app: "Gemma",
    environment: process.env.VERCEL_ENV || "local",
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    database,
    isolation: {
      sharedKnowledge:
        "read-only in chat/retrieval; admin-only Preview/Apply/Rollback/manual editing can update the canonical Knowledge",
      operationalWrites: "schema gemma",
      liaAldaOperationalWrites: 0,
    },
    attachmentStorage: {
      mode:
        process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN
          ? "blob-capable"
          : "database-preview-fallback",
      productionDbFallbackAllowed:
        String(process.env.GEMMA_ALLOW_DB_ATTACHMENTS || "").toLowerCase() ===
        "true",
    },
  });
}

import postgres from "postgres";

export const runtime = "nodejs";

export async function GET() {
  let database = {
    configured: Boolean(process.env.DATABASE_URL),
    reachable: false,
    readOnlyTransaction: false,
  };

  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, {
      max: 1,
      connect_timeout: 5,
      prepare: false,
    });

    try {
      const check = await sql.begin("read only", async (tx) => {
        const rows = await tx`
          SELECT current_setting('transaction_read_only') AS mode
        `;
        return rows[0]?.mode;
      });

      database = {
        configured: true,
        reachable: true,
        readOnlyTransaction: check === "on",
      };
    } catch {
      database = {
        configured: true,
        reachable: false,
        readOnlyTransaction: false,
      };
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }

  return Response.json({
    ok:
      Boolean(process.env.OPENAI_API_KEY) &&
      database.reachable &&
      database.readOnlyTransaction,
    app: "Gemma",
    environment: process.env.VERCEL_ENV || "local",
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    database,
    writeEndpoints: 0,
  });
}

import { requireRole } from "../../../../../lib/gemma-auth";
import {
  getKnowledgeSyncJob,
  listRecentKnowledgeJobs,
  startKnowledgeApply,
  startKnowledgePreview,
  stepKnowledgeApply,
  stepKnowledgePreview,
  stepKnowledgeRollback,
} from "../../../../../lib/gemma-knowledge-sync";

export const runtime = "nodejs";

async function admin(request) {
  return await requireRole(request, ["ADMIN"]);
}

export async function GET(request) {
  if (!(await admin(request))) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = String(url.searchParams.get("jobId") || "").trim();

  if (jobId) {
    const job = await getKnowledgeSyncJob(jobId);
    return job
      ? Response.json({ job })
      : Response.json({ error: "Job non trovato." }, { status: 404 });
  }

  return Response.json({
    jobs: await listRecentKnowledgeJobs(10),
  });
}

export async function POST(request) {
  const user = await admin(request);
  if (!user) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = String(body?.action || "").trim();

    if (action === "start-preview") {
      return Response.json({
        job: await startKnowledgePreview(user.name || user.email || "Admin"),
      });
    }

    if (action === "step-preview") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      return Response.json({
        job: await stepKnowledgePreview(jobId, body?.batchSize),
      });
    }

    if (action === "start-apply") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      return Response.json({
        job: await startKnowledgeApply(
          jobId,
          body?.proposalIds,
          user.name || user.email || "Admin",
        ),
      });
    }

    if (action === "step-apply") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      return Response.json({
        job: await stepKnowledgeApply(jobId, body?.batchSize),
      });
    }

    if (action === "rollback-step") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      return Response.json({
        job: await stepKnowledgeRollback(jobId, body?.batchSize),
      });
    }

    return Response.json(
      { error: "Operazione Knowledge non riconosciuta." },
      { status: 400 },
    );
  } catch (error) {
    console.error("Gemma Knowledge sync error", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Operazione Knowledge non riuscita.",
      },
      { status: 500 },
    );
  }
}

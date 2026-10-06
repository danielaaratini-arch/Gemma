import { after } from "next/server";
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
import {
  knowledgeJobIsActive,
  requestKnowledgeWorker,
} from "../../../../../lib/gemma-knowledge-worker";

export const runtime = "nodejs";

async function admin(request) {
  return await requireRole(request, ["ADMIN"]);
}

function continueInBackground(request, job) {
  if (!knowledgeJobIsActive(job)) return;
  const origin = new URL(request.url).origin;

  after(() =>
    requestKnowledgeWorker(origin, job.id).catch((error) => {
      console.error(
        "Gemma Knowledge background continuation error",
        error instanceof Error ? error.message : String(error),
      );
    }),
  );
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
      const job = await startKnowledgePreview(
        user.name || user.email || "Admin",
      );
      continueInBackground(request, job);
      return Response.json({ job });
    }

    if (action === "step-preview") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      const job = await stepKnowledgePreview(jobId, body?.batchSize);
      continueInBackground(request, job);
      return Response.json({ job });
    }

    if (action === "start-apply") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      const job = await startKnowledgeApply(
        jobId,
        body?.proposalIds,
        user.name || user.email || "Admin",
      );
      continueInBackground(request, job);
      return Response.json({ job });
    }

    if (action === "step-apply") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      const job = await stepKnowledgeApply(jobId, body?.batchSize);
      continueInBackground(request, job);
      return Response.json({ job });
    }

    if (action === "rollback-step") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) {
        return Response.json({ error: "Job mancante." }, { status: 400 });
      }
      const job = await stepKnowledgeRollback(jobId, body?.batchSize);
      continueInBackground(request, job);
      return Response.json({ job });
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

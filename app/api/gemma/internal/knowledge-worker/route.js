import { after } from "next/server";
import {
  advanceKnowledgeJob,
  knowledgeJobIsActive,
  requestKnowledgeWorker,
} from "../../../../../lib/gemma-knowledge-worker";

export const runtime = "nodejs";

function authorized(request) {
  const secret = String(
    process.env.GEMMA_KNOWLEDGE_WORKER_SECRET || "",
  ).trim();
  const header = String(request.headers.get("authorization") || "");
  return Boolean(secret) && header === "Bearer " + secret;
}

export async function POST(request) {
  if (!authorized(request)) {
    return Response.json({ error: "Non autorizzato." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const jobId = String(body?.jobId || "").trim();
    if (!jobId) {
      return Response.json({ error: "Job mancante." }, { status: 400 });
    }

    const job = await advanceKnowledgeJob(jobId);

    if (knowledgeJobIsActive(job)) {
      const origin = new URL(request.url).origin;
      after(() =>
        requestKnowledgeWorker(origin, jobId).catch((error) => {
          console.error(
            "Gemma Knowledge worker continuation error",
            error instanceof Error ? error.message : String(error),
          );
        }),
      );
    }

    return Response.json({
      jobId,
      status: job.status,
      active: knowledgeJobIsActive(job),
    });
  } catch (error) {
    console.error("Gemma Knowledge worker error", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Worker Knowledge non riuscito.",
      },
      { status: 500 },
    );
  }
}

import {
  getKnowledgeSyncJob,
  stepKnowledgeApply,
  stepKnowledgePreview,
  stepKnowledgeRollback,
} from "./gemma-knowledge-sync";

export function knowledgeJobIsActive(job) {
  return ["PREVIEWING", "APPLYING", "ROLLING_BACK"].includes(
    String(job?.status || ""),
  );
}

export async function advanceKnowledgeJob(jobId) {
  let job = await getKnowledgeSyncJob(jobId);
  if (!job) throw new Error("Job Knowledge non trovato.");

  if (job.status === "PREVIEWING") {
    job = await stepKnowledgePreview(jobId, 8);
  } else if (job.status === "APPLYING") {
    job = await stepKnowledgeApply(jobId, 10);
  } else if (job.status === "ROLLING_BACK") {
    job = await stepKnowledgeRollback(jobId, 10);
  }

  return job;
}

export async function requestKnowledgeWorker(origin, jobId) {
  const secret = String(
    process.env.GEMMA_KNOWLEDGE_WORKER_SECRET || "",
  ).trim();

  if (!secret || !origin || !jobId) {
    return { scheduled: false, reason: "not-configured" };
  }

  const url = new URL("/api/gemma/internal/knowledge-worker", origin);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: "Bearer " + secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobId }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Worker Knowledge non raggiungibile: HTTP " + response.status);
  }

  return { scheduled: true };
}

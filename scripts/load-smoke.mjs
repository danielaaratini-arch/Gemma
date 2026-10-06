const baseUrl = String(process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const users = Math.max(1, Math.min(2000, Number(process.env.USERS) || 100));
const rounds = Math.max(1, Math.min(20, Number(process.env.ROUNDS) || 1));
const path = process.env.LOAD_PATH || "/api/health";

const timings = [];
let failures = 0;

async function hit(index) {
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    try {
      const response = await fetch(baseUrl + path, {
        cache: "no-store",
        headers: {
          "x-gemma-load-user": String(index),
        },
      });
      await response.arrayBuffer();
      timings.push(performance.now() - started);
      if (!response.ok) failures += 1;
    } catch {
      timings.push(performance.now() - started);
      failures += 1;
    }
  }
}

await Promise.all(Array.from({ length: users }, (_, index) => hit(index)));

timings.sort((a, b) => a - b);
const percentile = (p) =>
  timings[Math.min(timings.length - 1, Math.floor(timings.length * p))] || 0;

console.log(JSON.stringify({
  target: baseUrl + path,
  users,
  rounds,
  requests: timings.length,
  failures,
  p50Ms: Math.round(percentile(0.50)),
  p95Ms: Math.round(percentile(0.95)),
  p99Ms: Math.round(percentile(0.99)),
  maxMs: Math.round(timings[timings.length - 1] || 0),
}, null, 2));

if (failures > 0) process.exitCode = 1;

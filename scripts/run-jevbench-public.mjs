#!/usr/bin/env node
// Public JevBench runner. Sends the vendored public fixture
// (bench/jevbench-public, 231 decisions) one request at a time to a
// /v1/systemone endpoint and writes comparable accuracy/latency artifacts.
//
// Targets any provider path by URL:
//   cascade  http://127.0.0.1:9011/v1/systemone  (gateway, default)
//   semif    http://127.0.0.1:9013/v1/systemone
//   laya     http://127.0.0.1:9012/v1/systemone  (needs --profile; short inputs only)
//   generated: start a gateway with JEVLOCAL_PROVIDER=generated, then point --url at it
//
// Usage:
//   node scripts/run-jevbench-public.mjs [--url ...] [--profile NAME]
//     [--cohort easy|original|hard] [--limit N] [--out DIR]
//
// Conversion follows JevBench's semif_direct convention: choice keeps caller
// keys, noul uses false/true criteria scored against yes/no labels, score
// uses ordered level indexes. Non-2xx answers are recorded as errors and
// counted incorrect; the run never stops early because of them.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback) {
  const hit = process.argv.find((item) => item.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

const url = arg("--url", "http://127.0.0.1:9011/v1/systemone");
const profile = arg("--profile", "");
const cohortFilter = arg("--cohort", "");
const limit = Number(arg("--limit", "0"));
const outDir = arg("--out", `results/jevbench-public/${new Date().toISOString().replace(/[:.]/g, "-")}`);
const tasksDir = new URL("../bench/jevbench-public/", import.meta.url);

const cohorts = ["easy", "original", "hard"].filter((name) => !cohortFilter || name === cohortFilter);
if (cohortFilter && cohorts.length === 0) throw new Error(`unknown --cohort=${cohortFilter}`);

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function buildRequest(task) {
  const question = {
    type: task.question.type,
    instructions: task.question.instructions,
    criteria: task.question.criteria,
  };
  const payload = { model: "jev-latest", state: task.state, questions: { q: question } };
  if (profile) payload.routing_profile = profile;
  return payload;
}

function score(task, status, body) {
  if (status !== 200 || !body?.answers?.q) {
    return { correct: false, predicted: null, error: `http-${status}` };
  }
  const answer = body.answers.q;
  if (task.question.type === "choice") {
    return { correct: answer.choice === task.expected, predicted: answer.choice, error: null };
  }
  if (task.question.type === "noul") {
    if (typeof answer.noul !== "number") return { correct: false, predicted: null, error: "bad-noul-shape" };
    const predicted = answer.noul >= 0.5 ? "yes" : "no";
    return { correct: predicted === task.expected, predicted, error: null };
  }
  if (typeof answer.score !== "number") return { correct: false, predicted: null, error: "bad-score-shape" };
  return { correct: answer.score === task.expected, predicted: answer.score, error: null };
}

const health = await fetch(url.replace(/\/v1\/systemone$/, "/health")).then((r) => r.json()).catch(() => null);
const rows = [];
for (const cohort of cohorts) {
  const lines = readFileSync(new URL(`./${cohort}.jsonl`, tasksDir), "utf8").trim().split("\n");
  for (const line of lines) {
    const task = JSON.parse(line);
    if (task.split !== "public") throw new Error(`refusing non-public task ${task.id}`);
    const started = performance.now();
    let status = 0;
    let body = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRequest(task)),
      });
      status = response.status;
      body = await response.json().catch(() => null);
    } catch (cause) {
      body = { error: { message: String(cause) } };
    }
    const latencyMs = Number((performance.now() - started).toFixed(1));
    const result = score(task, status, body);
    rows.push({
      id: task.id, cohort, type: task.question.type,
      expected: task.expected, predicted: result.predicted,
      correct: result.correct, error: result.error, latency_ms: latencyMs,
    });
    console.error(`${task.id} ${result.error ?? (result.correct ? "ok" : "miss")} ${latencyMs}ms`);
    if (limit > 0 && rows.length >= limit) break;
  }
  if (limit > 0 && rows.length >= limit) break;
}

function summarize(items) {
  const ok = items.filter((row) => !row.error);
  const latencies = items.map((row) => row.latency_ms);
  return {
    n: items.length,
    correct: items.filter((row) => row.correct).length,
    accuracy: Number((items.filter((row) => row.correct).length / items.length).toFixed(4)),
    errors: items.length - ok.length,
    latency_ms: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
  };
}

const summary = {
  manifest: {
    date: new Date().toISOString(),
    url, profile: profile || null,
    gateway_health: health,
    node: process.version,
    data: cohorts.map((cohort) => {
      const raw = readFileSync(new URL(`./${cohort}.jsonl`, tasksDir));
      return { cohort, sha256: createHash("sha256").update(raw).digest("hex"), n: raw.toString().trim().split("\n").length };
    }),
  },
  overall: summarize(rows),
  by_cohort: Object.fromEntries(cohorts.map((cohort) => [cohort, summarize(rows.filter((row) => row.cohort === cohort))])),
  by_type: Object.fromEntries(["choice", "noul", "score"].map((type) => [type, summarize(rows.filter((row) => row.type === type))])),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "rows.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ outDir, ...summary.overall, by_cohort: summary.by_cohort }, null, 2));

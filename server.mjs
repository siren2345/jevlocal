import { createServer } from "node:http";

const host = process.env.JEVLOCAL_HOST ?? "127.0.0.1";
const port = Number(process.env.JEVLOCAL_PORT ?? "9011");
const semifUrl = process.env.JEVLOCAL_SEMIF_URL ?? "http://127.0.0.1:9013/v1/systemone";
const layaUrl = process.env.JEVLOCAL_LAYA_URL ?? "http://127.0.0.1:9012/v1/systemone";

// Automatic fast-path admission. Mechanical rules only: no model calls to
// decide routing, no confidence thresholds. Anything not admitted goes to
// SemIf, and any Laya failure falls back to SemIf.
const LAYA_TOKEN_CAP = 72; // 75% of the ANE 96-token export limit; chars/4 estimate
const LAYA_MAX_OPTIONS = 8;
const REASONING = /\b(explain|reason(?:ing)?|justify|infer(?:ence)?|ambig(?:uous|uity)|bias|stereotyp(?:e|ical)|according to the passage|can(?:not|'t) be determined|cannot answer|not answerable|undetermined|unknown|not known|uncertain|not enough (?:information|info)|insufficient information|none of the above)\b|理由|根拠|推論|曖昧|偏見|判断不能|不明|わからない|情報不足/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asText(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function error(message, status = 422) {
  const result = new Error(message);
  result.status = status;
  return result;
}

function validateQuestion(name, question) {
  if (!isRecord(question)) throw error(`questions.${name} must be an object`);
  if (!['choice', 'noul', 'score'].includes(question.type)) throw error(`questions.${name}.type must be choice, noul, or score`);
  if (question.type === 'choice') {
    if (!isRecord(question.criteria)) throw error(`questions.${name}.criteria must be an option map`);
    const count = Object.keys(question.criteria).length;
    if (count < 1 || count > 26) throw error(`questions.${name}.criteria must contain 1 to 26 options`);
  }
  if (question.type === 'noul' && question.criteria !== undefined && !isRecord(question.criteria)) throw error(`questions.${name}.criteria must be an object when provided`);
  if (question.type === 'score') {
    if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) throw error(`questions.${name}.criteria must contain 2 to 10 ordered levels`);
  }
}

export function validateRequest(body) {
  if (!isRecord(body)) throw error('request body must be an object');
  if (!Object.hasOwn(body, 'state')) throw error('state is required');
  if (!isRecord(body.questions) || Object.keys(body.questions).length === 0) throw error('questions must be a non-empty object');
  for (const [name, question] of Object.entries(body.questions)) validateQuestion(name, question);
  return body;
}

function estimateTokens(request) {
  const parts = [asText(request.state)];
  for (const question of Object.values(request.questions)) {
    parts.push(asText(question.instructions ?? ''));
    parts.push(asText(question.criteria ?? ''));
  }
  const chars = parts.join('\n').length;
  return Math.ceil(chars / 4);
}

export function admission(request) {
  // Returns { provider: 'laya'|'semif', reason } — pure function of the request.
  const names = Object.keys(request.questions);
  if (names.length !== 1) return { provider: 'semif', reason: 'multi-question requests stay on the quality provider' };
  const question = request.questions[names[0]];
  if (question.type !== 'choice') return { provider: 'semif', reason: `${question.type} stays on the quality provider` };
  const options = Object.keys(question.criteria).length;
  if (options > LAYA_MAX_OPTIONS) return { provider: 'semif', reason: `${options} options exceed the fast-path limit` };
  const text = [asText(request.state), asText(question.instructions ?? ''), Object.values(question.criteria).map(asText).join(' ')].join('\n');
  if (REASONING.test(text)) return { provider: 'semif', reason: 'reasoning-shaped input stays on the quality provider' };
  const tokens = estimateTokens(request);
  if (tokens > LAYA_TOKEN_CAP) return { provider: 'semif', reason: `~${tokens} tokens exceed the fast-path budget` };
  return { provider: 'laya', reason: `compact choice (~${tokens} tokens, ${options} options)` };
}

async function callProvider(url, payload, provider) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw error(`${provider} is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`, 503);
  }
  let body;
  try { body = await response.json(); } catch { throw error(`${provider} returned non-JSON output`, 502); }
  if (!response.ok) throw error(`${provider} error: ${JSON.stringify(body).slice(0, 500)}`, response.status === 422 ? 422 : 503);
  if (!isRecord(body.answers)) throw error(`${provider} returned no answers object`, 502);
  return body;
}

function tag(body, provider, reason) {
  return {
    ...body,
    metadata: {
      ...(isRecord(body.metadata) ? body.metadata : {}),
      provider,
      route_reason: reason,
    },
  };
}

export async function systemOne(payload) {
  const request = validateRequest(payload);
  const route = admission(request);
  if (route.provider === 'laya') {
    try {
      const requestWithModel = typeof request.model !== "string"
        ? { ...request, model: "jev-latest" }
        : request;
      const body = await callProvider(layaUrl, requestWithModel, "laya-coreml-ane");
      return tag(body, "laya-coreml-ane", `fast path: ${route.reason}`);
    } catch (cause) {
      const body = await callProvider(semifUrl, request, "semif/mlx fallback");
      return tag(body, "semif/mlx", `fast path failed; quality fallback (${cause instanceof Error ? cause.message : "provider error"})`);
    }
  }
  const body = await callProvider(semifUrl, request, "semif/mlx");
  return tag(body, "semif/mlx", `quality default: ${route.reason}`);
}

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const parts = [];
  for await (const part of request) parts.push(part);
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw error('request body must be valid JSON'); }
}

export function createGateway() {
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') return writeJson(response, 200, {
      status: 'ok', mode: 'auto', providers: { semif: semifUrl, laya: layaUrl },
    });
    if (request.method === 'GET' && request.url === '/v1/models') return writeJson(response, 200, { object: 'list', data: [{ id: 'jev-latest', object: 'model', owned_by: 'jevlocal-mac' }] });
    if (request.method !== 'POST' || !['/v1/systemone', '/v1/decide'].includes(request.url)) return writeJson(response, 404, { error: { message: 'not found' } });
    try { writeJson(response, 200, await systemOne(await readJson(request))); }
    catch (cause) { writeJson(response, cause?.status ?? 500, { error: { message: cause instanceof Error ? cause.message : 'internal error' } }); }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createGateway().listen(port, host, () => console.log(`jevlocal-mac listening on http://${host}:${port}`));
}

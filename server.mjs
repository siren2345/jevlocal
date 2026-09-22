import { createServer } from "node:http";

const host = process.env.JEVLOCAL_HOST ?? "127.0.0.1";
const port = Number(process.env.JEVLOCAL_PORT ?? "9011");
const llamaUrl = process.env.LLAMA_URL ?? "http://127.0.0.1:9030/v1/chat/completions";
const llamaModel = process.env.LLAMA_MODEL ?? "qwen3-4b";
const providerMode = process.env.JEVLOCAL_PROVIDER ?? "semif";
const semifUrl = process.env.JEVLOCAL_SEMIF_URL ?? "http://127.0.0.1:9013/v1/systemone";
const layaUrl = process.env.JEVLOCAL_LAYA_URL ?? "http://127.0.0.1:9012/v1/systemone";
const layaProfiles = new Set((process.env.JEVLOCAL_LAYA_PROFILES ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const labels = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

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

function choiceShape(question) {
  if (question.type === 'choice') {
    const keys = Object.keys(question.criteria);
    return { keys, options: keys.map((key) => asText(question.criteria[key])) };
  }
  if (question.type === 'noul') {
    const criteria = question.criteria ?? {};
    return { keys: ['false', 'true'], options: [asText(criteria.false ?? 'No, the condition is false.'), asText(criteria.true ?? 'Yes, the condition is true.')] };
  }
  return { keys: question.criteria.map((_, index) => String(index)), options: question.criteria.map(asText) };
}

function buildPrompt(state, question, options) {
  const text = options.map((option, index) => `${labels[index]}. ${option}`).join('\n');
  return [
    'Make one typed decision from the supplied state and instructions.',
    'Use only the supplied state as evidence. Do not add unstated assumptions.',
    '',
    `STATE:\n${asText(state)}`,
    '',
    `INSTRUCTIONS:\n${asText(question.instructions ?? '')}`,
    '',
    `OPTIONS:\n${text}`,
    '',
    'Return only the option label.',
  ].join('\n');
}

function grammar(optionLabels) {
  return `root ::= ${optionLabels.map(JSON.stringify).join(' | ')}`;
}

function decodeLabel(content, optionLabels) {
  const last = [...content].reverse().find((character) => optionLabels.includes(character));
  if (!last) throw error('upstream returned no constrained option label', 502);
  return last;
}

async function decide(state, question) {
  const { keys, options } = choiceShape(question);
  const optionLabels = labels.slice(0, keys.length);
  const started = performance.now();
  let response;
  try {
    response = await fetch(llamaUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: llamaModel,
        messages: [{ role: 'user', content: buildPrompt(state, question, options) }],
        temperature: 0,
        max_tokens: 1,
        grammar: grammar(optionLabels),
        // Qwen3's current template can emit an empty think wrapper. The
        // constrained label remains the final visible character and is decoded above.
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
  } catch (cause) {
    throw error(`llama.cpp is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`, 503);
  }
  const elapsed = Number((performance.now() - started).toFixed(1));
  let body;
  try { body = await response.json(); } catch { throw error('llama.cpp returned non-JSON output', 502); }
  if (!response.ok) throw error(`llama.cpp error: ${JSON.stringify(body).slice(0, 500)}`, 502);
  const label = decodeLabel(body.choices?.[0]?.message?.content ?? '', optionLabels);
  const index = optionLabels.indexOf(label);
  return { key: keys[index], elapsed, inputTokens: body.usage?.prompt_tokens ?? 0 };
}

function answer(question, result) {
  if (question.type === 'choice') {
    const probabilities = Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === result.key ? 1 : 0]));
    return { type: 'choice', choice: result.key, probabilities, confidence: 1 };
  }
  if (question.type === 'noul') return { type: 'noul', noul: result.key === 'true' ? 1 : 0 };
  const legend = Object.fromEntries(question.criteria.map((item, index) => [String(index), asText(item)]));
  return { type: 'score', score: Number(result.key), confidence: 1, legend, probabilities: Object.fromEntries(question.criteria.map((_, index) => [String(index), String(index) === result.key ? 1 : 0])) };
}

async function generatedSystemOne(payload) {
  const request = validateRequest(payload);
  const answers = {};
  const timings = [];
  let inputTokens = 0;
  for (const [name, question] of Object.entries(request.questions)) {
    const result = await decide(request.state, question);
    answers[name] = answer(question, result);
    timings.push(result.elapsed);
    inputTokens += result.inputTokens;
  }
  return {
    model: 'jevlocal-mac-qwen3-4b-q4-k-m',
    answers,
    usage: { input_tokens: inputTokens, output_tokens: Object.keys(answers).length },
    metadata: {
      provider: 'llama.cpp/Qwen3-4B-Q4_K_M',
      route_reason: 'quality-default',
      probabilities: 'Deterministic constrained greedy decisions, not calibrated probabilities.',
      performance: { inference_ms: Number(timings.reduce((total, value) => total + value, 0).toFixed(1)), per_question_ms: timings },
    },
  };
}

function requestedProfile(payload) {
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  return payload.routing_profile ?? metadata.routing_profile ?? null;
}

function shouldUseLaya(payload) {
  // Fast admission is explicit. A model confidence threshold is deliberately
  // not used as a general-purpose quality test: it was shown task-dependent.
  const profile = requestedProfile(payload);
  return typeof profile === "string" && layaProfiles.has(profile);
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

export async function systemOne(payload) {
  const request = validateRequest(payload);
  if (providerMode === "generated") return generatedSystemOne(request);

  const useLaya = providerMode === "laya" || (providerMode === "cascade" && shouldUseLaya(request));
  const selected = useLaya ? { name: "laya-coreml-ane", url: layaUrl } : { name: "semif/mlx", url: semifUrl };
  try {
    // Laya's current Core ML service requires the optional-at-gateway model
    // field. Keep callers JeV-compatible by supplying its local default only
    // at that provider boundary.
    const providerRequest = useLaya && typeof request.model !== "string"
      ? { ...request, model: "jev-latest" }
      : request;
    const body = await callProvider(selected.url, providerRequest, selected.name);
    return {
      ...body,
      metadata: {
        ...(isRecord(body.metadata) ? body.metadata : {}),
        provider: selected.name,
        route_reason: useLaya
          ? `explicit fast profile '${requestedProfile(request)}'`
          : "quality default; SemIf direct option scoring",
      },
    };
  } catch (cause) {
    // An admitted fast request must still preserve availability when Laya's
    // local model is unavailable. SemIf is the only automatic fallback.
    if (useLaya && providerMode === "cascade") {
      const body = await callProvider(semifUrl, request, "semif/mlx fallback");
      return {
        ...body,
        metadata: {
          ...(isRecord(body.metadata) ? body.metadata : {}),
          provider: "semif/mlx",
          route_reason: `Laya fast route failed; SemIf fallback (${cause instanceof Error ? cause.message : "provider error"})`,
        },
      };
    }
    throw cause;
  }
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
      status: 'ok', provider_mode: providerMode,
      providers: { semif: semifUrl, laya: layaUrl, generated: llamaUrl },
      laya_profiles: [...layaProfiles],
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

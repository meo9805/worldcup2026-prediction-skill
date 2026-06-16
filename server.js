import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT || 4317);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = Buffer.isBuffer(body)
    ? body
    : typeof body === "string"
      ? body
      : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store"
  });
  res.end(payload);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = normalize(join(PUBLIC_DIR, pathname));
  if (!target.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  try {
    const data = await readFile(target);
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "content-type": MIME[extname(target)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end();
      return;
    }
    send(res, 200, data, MIME[extname(target)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function buildMatchPrompt(input, batch = false) {
  const realtime = input.realtime?.trim()
    ? `\n用户补充的实时信息：\n${input.realtime.trim()}`
    : "\n用户未提供首发、伤停、市场基线或天气时，必须按文档降置信并考虑 PASS。";

  if (batch) {
    return `请按 skill 规则逐场分析以下比赛，输出 {"predictions":[...]}，只输出合法 JSON，不要 markdown。\n\n${input.matches.trim()}\n${realtime}`;
  }

  return `请预测这场 2026 世界杯比赛，严格按 skill 的 JSON 字段输出，只输出合法 JSON，不要 markdown。\n\n` +
    `阶段：${input.stage || "小组赛"}\n` +
    `小组：${input.group || "unknown"}\n` +
    `队伍：${input.teamA} vs ${input.teamB}\n` +
    `开球北京时间：${input.kickoffBeijing || "unknown"}\n` +
    `${realtime}`;
}

async function callModel({ apiKey, endpoint, model, prompt }) {
  const key = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error("缺少 API Key：请在页面设置里粘贴 DeepSeek API Key，或启动前设置 DEEPSEEK_API_KEY。");
    err.status = 400;
    throw err;
  }

  const skill = await readFile(join(ROOT, "skill.md"), "utf8");
  const response = await fetch(endpoint || "https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model: model || "deepseek-chat",
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: 5000,
      messages: [
        { role: "system", content: skill },
        { role: "user", content: prompt }
      ]
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    const err = new Error(`模型接口返回 ${response.status}：${raw.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }

  const payload = JSON.parse(raw);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error("模型没有返回 content。");
    err.status = 502;
    throw err;
  }
  return JSON.parse(content);
}

function outcomeFromScore(score) {
  const match = String(score || "").trim().match(/^(\d{1,2})\s*[-:：]\s*(\d{1,2})$/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a > b) return "teamAWin";
  if (a < b) return "teamBWin";
  return "draw";
}

function predictedOutcome(prediction) {
  const probs = prediction?.modelAdjusted || {};
  const entries = [
    ["teamAWin", Number(probs.teamAWin || 0)],
    ["draw", Number(probs.draw || 0)],
    ["teamBWin", Number(probs.teamBWin || 0)]
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function brierScore(prediction, outcome) {
  const probs = prediction?.modelAdjusted || {};
  const p = {
    teamAWin: Number(probs.teamAWin || 0) / 100,
    draw: Number(probs.draw || 0) / 100,
    teamBWin: Number(probs.teamBWin || 0) / 100
  };
  return ["teamAWin", "draw", "teamBWin"].reduce((sum, key) => {
    const actual = key === outcome ? 1 : 0;
    return sum + Math.pow((p[key] || 0) - actual, 2);
  }, 0);
}

function safestDirectionHit(prediction, outcome) {
  const pick = String(prediction?.safestDirection?.pick || "");
  const type = prediction?.safestDirection?.type;
  const teamA = String(prediction?.match?.teamA || "");
  const teamB = String(prediction?.match?.teamB || "");

  if (!outcome || type === "pass") return null;
  if (pick.includes("不败")) {
    if (teamA && pick.includes(teamA)) return outcome !== "teamBWin";
    if (teamB && pick.includes(teamB)) return outcome !== "teamAWin";
  }
  if (pick.includes("平")) return outcome === "draw";
  if (teamA && pick.includes(teamA)) return outcome === "teamAWin";
  if (teamB && pick.includes(teamB)) return outcome === "teamBWin";
  return null;
}

function reviewPrediction(prediction, actualScore) {
  const outcome = outcomeFromScore(actualScore);
  if (!outcome) {
    const err = new Error("实际比分格式应为 1-1 或 2:0。");
    err.status = 400;
    throw err;
  }
  const primary = predictedOutcome(prediction);
  const brier = brierScore(prediction, outcome);
  return {
    actualScore,
    outcome,
    primaryPrediction: primary,
    outcomeHit: primary === outcome,
    safestDirectionHit: safestDirectionHit(prediction, outcome),
    brierScore: Number(brier.toFixed(4)),
    failureReasonSuggestion: primary === outcome
      ? []
      : outcome === "draw"
        ? ["draw_underestimated", "favorite_bias"]
        : ["favorite_bias"],
    nextAdjustmentSuggestion: primary === outcome
      ? "保留当前权重，继续观察同类场景。"
      : outcome === "draw"
        ? "同类小组赛首轮平局概率上调，强队单胜降档，parlaySafety 不得给 A。"
        : "复查首发、伤停、市场基线和低位防守因素，避免只按名气给方向。"
  };
}

async function handleApi(req, res) {
  try {
    const body = await readJson(req);
    if (req.url === "/api/health") {
      send(res, 200, {
        ok: true,
        hasServerApiKey: Boolean(process.env.DEEPSEEK_API_KEY),
        defaultModel: "deepseek-chat"
      });
      return;
    }
    if (req.url === "/api/predict") {
      const prompt = buildMatchPrompt(body);
      const prediction = await callModel({ ...body, prompt });
      send(res, 200, { prediction });
      return;
    }
    if (req.url === "/api/batch") {
      const prompt = buildMatchPrompt(body, true);
      const prediction = await callModel({ ...body, prompt });
      send(res, 200, { prediction });
      return;
    }
    if (req.url === "/api/review") {
      send(res, 200, { review: reviewPrediction(body.prediction, body.actualScore) });
      return;
    }
    send(res, 404, { error: "Unknown API route" });
  } catch (error) {
    send(res, error.status || 500, { error: error.message || "Server error" });
  }
}

const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/") && req.method === "POST") {
    handleApi(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }
  send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
});

server.listen(PORT, () => {
  console.log(`WorldCup predictor is running at http://localhost:${PORT}`);
});

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

const FIFA_FIXTURES_URL = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures";
const READER_PREFIX = "https://r.jina.ai/http://r.jina.ai/http://";

const TEAM_ZH = {
  "Argentina": "阿根廷",
  "Algeria": "阿尔及利亚",
  "Australia": "澳大利亚",
  "Austria": "奥地利",
  "Belgium": "比利时",
  "Bosnia and Herzegovina": "波黑",
  "Brazil": "巴西",
  "Cabo Verde": "佛得角",
  "Canada": "加拿大",
  "Colombia": "哥伦比亚",
  "Congo DR": "刚果金",
  "Côte d'Ivoire": "科特迪瓦",
  "Curaçao": "库拉索",
  "Czechia": "捷克",
  "Ecuador": "厄瓜多尔",
  "Egypt": "埃及",
  "England": "英格兰",
  "France": "法国",
  "Germany": "德国",
  "Ghana": "加纳",
  "Haiti": "海地",
  "IR Iran": "伊朗",
  "Iraq": "伊拉克",
  "Japan": "日本",
  "Jordan": "约旦",
  "Korea Republic": "韩国",
  "Mexico": "墨西哥",
  "Morocco": "摩洛哥",
  "Netherlands": "荷兰",
  "New Zealand": "新西兰",
  "Norway": "挪威",
  "Panama": "巴拿马",
  "Paraguay": "巴拉圭",
  "Portugal": "葡萄牙",
  "Qatar": "卡塔尔",
  "Saudi Arabia": "沙特",
  "Scotland": "苏格兰",
  "Senegal": "塞内加尔",
  "South Africa": "南非",
  "Spain": "西班牙",
  "Sweden": "瑞典",
  "Switzerland": "瑞士",
  "Tunisia": "突尼斯",
  "Türkiye": "土耳其",
  "Uruguay": "乌拉圭",
  "USA": "美国",
  "Uzbekistan": "乌兹别克斯坦"
};

const MONTHS = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12"
};

const LOCAL_FIXTURE_SNAPSHOT = [
  ["2026-06-15", "Monday 15 June 2026", "", "finished", "F", "Sweden", "Tunisia", 5, 1, "Monterrey Stadium", "Monterrey", "400021474"],
  ["2026-06-15", "Monday 15 June 2026", "", "finished", "H", "Spain", "Cabo Verde", 0, 0, "Atlanta Stadium", "Atlanta", "400021482"],
  ["2026-06-15", "Monday 15 June 2026", "", "finished", "G", "Belgium", "Egypt", 1, 1, "Seattle Stadium", "Seattle", "400021478"],
  ["2026-06-15", "Monday 15 June 2026", "", "finished", "H", "Saudi Arabia", "Uruguay", 1, 1, "Miami Stadium", "Miami", "400021486"],
  ["2026-06-16", "Tuesday 16 June 2026", "01:00", "scheduled", "G", "IR Iran", "New Zealand", null, null, "Los Angeles Stadium", "Los Angeles", "400021476"],
  ["2026-06-16", "Tuesday 16 June 2026", "19:00", "scheduled", "I", "France", "Senegal", null, null, "New York/New Jersey Stadium", "New Jersey", "400021490"],
  ["2026-06-16", "Tuesday 16 June 2026", "22:00", "scheduled", "I", "Iraq", "Norway", null, null, "Boston Stadium", "Boston", "400021488"],
  ["2026-06-17", "Wednesday 17 June 2026", "01:00", "scheduled", "J", "Argentina", "Algeria", null, null, "Kansas City Stadium", "Kansas City", "400021496"],
  ["2026-06-17", "Wednesday 17 June 2026", "04:00", "scheduled", "J", "Austria", "Jordan", null, null, "San Francisco Bay Area Stadium", "San Francisco Bay Area", "400021498"],
  ["2026-06-17", "Wednesday 17 June 2026", "17:00", "scheduled", "K", "Portugal", "Congo DR", null, null, "Houston Stadium", "Houston", "400021502"],
  ["2026-06-17", "Wednesday 17 June 2026", "20:00", "scheduled", "L", "England", "Croatia", null, null, "Dallas Stadium", "Dallas", "400021507"],
  ["2026-06-17", "Wednesday 17 June 2026", "23:00", "scheduled", "L", "Ghana", "Panama", null, null, "Toronto Stadium", "Toronto", "400021510"]
].map(([date, dateLabel, time, status, group, teamA, teamB, scoreA, scoreB, stadium, city, id]) => ({
  id,
  date,
  dateLabel,
  time,
  status,
  group,
  stage: "小组赛",
  teamA,
  teamB,
  teamAZh: TEAM_ZH[teamA] || teamA,
  teamBZh: TEAM_ZH[teamB] || teamB,
  scoreA,
  scoreB,
  stadium,
  city,
  sourceUrl: `https://www.fifa.com/en/match-centre/match/17/285023/289273/${id}`,
  sources: ["内置赛程快照"]
}));

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

function readerUrl(url) {
  return `${READER_PREFIX}${url}`;
}

async function fetchText(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextResult(label, url, timeoutMs = 8000) {
  const startedAt = Date.now();
  try {
    const text = await fetchText(url, timeoutMs);
    return { label, ok: true, url, ms: Date.now() - startedAt, text };
  } catch (error) {
    return { label, ok: false, url, ms: Date.now() - startedAt, error: error.message };
  }
}

function toIsoDate(label) {
  const match = label.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${MONTHS[match[2]] || "01"}-${String(match[1]).padStart(2, "0")}`;
}

function stripMarkdownImages(text) {
  return text.replace(/!\[[^\]]*?\]\([^)]+?\)/g, "");
}

function parseFixtureLabel(raw, dateLabel, url, sourceLabel = "FIFA官方赛程") {
  const label = raw.replace(/\s+/g, " ").trim();
  const meta = label.match(/(.+?)\s+First Stage·\s+Group\s+([A-L])·\s+(.+?)\(([^)]+)\)$/);
  if (!meta) return null;

  const front = meta[1].trim();
  const group = meta[2];
  const stadium = meta[3].trim();
  const city = meta[4].trim();

  let parsed = front.match(/^([A-Z]{2,3})\s+(.+?)\s+(\d+)\s+FT\s+(\d+)\s+([A-Z]{2,3})\s+(.+)$/);
  let status = "finished";
  let scoreA = null;
  let scoreB = null;
  let time = "";

  if (parsed) {
    scoreA = Number(parsed[3]);
    scoreB = Number(parsed[4]);
  } else {
    parsed = front.match(/^([A-Z]{2,3})\s+(.+?)\s+(\d+)\s+(\d{1,3}'(?:\+\d+)?)\s+(\d+)\s+([A-Z]{2,3})\s+(.+)$/);
    if (parsed) {
      status = "live";
      scoreA = Number(parsed[3]);
      time = parsed[4];
      scoreB = Number(parsed[5]);
      parsed = [parsed[0], parsed[1], parsed[2], parsed[3], parsed[5], parsed[6], parsed[7]];
    } else {
      parsed = front.match(/^([A-Z]{2,3})\s+(.+?)\s+(\d{2}:\d{2})\s+([A-Z]{2,3})\s+(.+)$/);
      if (!parsed) return null;
      status = "scheduled";
      time = parsed[3];
      parsed = [parsed[0], parsed[1], parsed[2], "", "", parsed[4], parsed[5]];
    }
  }

  const teamA = parsed[2].trim();
  const teamB = parsed[6].trim();
  const isoDate = toIsoDate(dateLabel);
  return {
    id: url.split("/").pop()?.split("?")[0] || `${isoDate}-${teamA}-${teamB}`,
    dateLabel,
    date: isoDate,
    time,
    status,
    group,
    stage: "小组赛",
    teamA,
    teamB,
    teamAZh: TEAM_ZH[teamA] || teamA,
    teamBZh: TEAM_ZH[teamB] || teamB,
    scoreA,
    scoreB,
    stadium,
    city,
    sourceUrl: url,
    sources: [sourceLabel]
  };
}

async function loadFixturesFromMarkdown(markdown, sourceLabel) {
  const lines = markdown.split(/\r?\n/);
  const fixtures = [];
  let dateLabel = "";
  const datePattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}$/;
  const linkPattern = /\[([^\]]+?)\]\((https:\/\/www\.fifa\.com\/en\/match-centre\/match\/[^)]+?)\)/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (datePattern.test(trimmed)) {
      dateLabel = trimmed;
      continue;
    }
    if (!dateLabel || !trimmed.includes("First Stage")) continue;

    let match;
    while ((match = linkPattern.exec(trimmed))) {
      const fixture = parseFixtureLabel(match[1], dateLabel, match[2], sourceLabel);
      if (fixture) fixtures.push(fixture);
    }
  }
  return fixtures;
}

function mergeFixtures(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const fixture of list || []) {
      const existing = map.get(fixture.id);
      if (!existing) {
        map.set(fixture.id, { ...fixture, sources: [...new Set(fixture.sources || [])] });
      } else {
        existing.sources = [...new Set([...(existing.sources || []), ...(fixture.sources || [])])];
        if (existing.status === "scheduled" && fixture.status !== "scheduled") {
          Object.assign(existing, fixture, { sources: existing.sources });
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => `${a.date} ${a.time || "99:99"}`.localeCompare(`${b.date} ${b.time || "99:99"}`));
}

async function loadFixtures({ date } = {}) {
  const urls = [
    { label: "FIFA官方赛程", url: readerUrl(FIFA_FIXTURES_URL) },
    { label: "FIFA日期赛程", url: readerUrl(`${FIFA_FIXTURES_URL}?date=${date || "2026-06-16"}`) }
  ];
  const results = await Promise.all(urls.map((item) => fetchTextResult(item.label, item.url, 9000)));
  const parsedLists = [];
  for (const result of results) {
    if (result.ok) {
      parsedLists.push(await loadFixturesFromMarkdown(stripMarkdownImages(result.text), result.label));
    }
  }

  const primary = mergeFixtures(...parsedLists);
  const fallbackUsed = primary.length === 0;
  const fixtures = fallbackUsed ? mergeFixtures(LOCAL_FIXTURE_SNAPSHOT) : mergeFixtures(primary, LOCAL_FIXTURE_SNAPSHOT);
  const sources = results.map(({ label, ok, url, ms, error }) => ({ label, ok, url, ms, error }));
  sources.push({
    label: "内置赛程快照",
    ok: true,
    used: fallbackUsed ? "primary-fallback" : "backup-merged",
    count: LOCAL_FIXTURE_SNAPSHOT.length
  });
  return { fixtures, sources };
}

function filterFixtures(fixtures, { date, window = 1, includeFinished = false }) {
  const start = date || "2026-06-16";
  const endTime = Date.parse(`${start}T00:00:00Z`) + (Number(window) || 1) * 86400000;
  return fixtures.filter((fixture) => {
    const time = Date.parse(`${fixture.date}T00:00:00Z`);
    const inRange = time >= Date.parse(`${start}T00:00:00Z`) && time < endTime;
    return inRange && (includeFinished || fixture.status !== "finished");
  });
}

function compactIntelligenceText(text, match) {
  return text
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .filter((line) => {
        const lower = line.toLowerCase();
        return /#|xi|lineup|injur|weather|score|group|stadium|coach|team|match|kick|formation|goal|substitut|preview|live|FT|HT/i.test(line) ||
          lower.includes(match.teamA.toLowerCase()) ||
          lower.includes(match.teamB.toLowerCase());
      })
      .slice(0, 80)
      .join("\n")
      .slice(0, 3500);
}

async function fetchMatchIntelligence(match) {
  const sources = [
    {
      label: "FIFA单场页",
      url: match?.sourceUrl ? readerUrl(match.sourceUrl) : "",
      timeoutMs: 7000
    },
    {
      label: "FIFA赛程行",
      inline: describeFixtureSummary(match)
    }
  ];

  const results = await Promise.all(sources.map(async (source) => {
    if (source.inline) return { label: source.label, ok: true, text: source.inline };
    if (!source.url) return { label: source.label, ok: false, error: "missing url" };
    return fetchTextResult(source.label, source.url, source.timeoutMs);
  }));

  const sourceSummary = results.map(({ label, ok, url, ms, error }) => ({ label, ok, url, ms, error }));
  const text = results
    .filter((item) => item.ok && item.text)
    .map((item) => `【${item.label}】\n${item.label === "FIFA单场页" ? compactIntelligenceText(item.text, match) : item.text}`)
    .join("\n\n")
    .slice(0, 4500);

  return {
    text: text || "自动情报抓取失败，必须按缺少首发/伤停/市场基线处理。",
    sources: sourceSummary
  };
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

function describeFixtureSummary(match) {
  const score = match.status !== "scheduled" ? ` 比分：${match.scoreA ?? "-"}-${match.scoreB ?? "-"}。` : "";
  const sources = match.sources?.length ? ` 来源：${match.sources.join("、")}。` : "";
  return `${match.group}组 ${match.teamAZh || match.teamA} vs ${match.teamBZh || match.teamB}，${match.date} ${match.time || ""}，${match.stadium || ""}${match.city ? `(${match.city})` : ""}，状态 ${match.status}。${score}${sources}`;
}

function describeFixture(match, intelligence = "") {
  const base = `${match.group}组 ${match.teamAZh || match.teamA} vs ${match.teamBZh || match.teamB}，${match.stage || "小组赛"}，FIFA显示时间 ${match.date} ${match.time || ""}，地点 ${match.stadium || ""}${match.city ? `(${match.city})` : ""}，状态 ${match.status}。`;
  const score = match.status !== "scheduled" ? ` 当前/最终比分：${match.scoreA ?? "-"}-${match.scoreB ?? "-"}。` : "";
  const source = match.sourceUrl ? ` 官方来源：${match.sourceUrl}` : "";
  const intel = intelligence ? `\n自动抓取情报摘要：\n${intelligence}` : "\n自动抓取情报摘要：未抓取到可用首发/伤停/市场信息，必须按缺失处理。";
  return `${base}${score}${source}${intel}`;
}

async function buildFixturePrompt(input) {
  const matches = Array.isArray(input.matches) ? input.matches.slice(0, 10) : [];
  if (!matches.length) {
    const err = new Error("没有可预测的比赛。请先刷新赛程或选择比赛。");
    err.status = 400;
    throw err;
  }

  const withIntel = [];
  const intelByMatch = [];
  for (const match of matches) {
    const intelligence = input.autoIntel === false
      ? { text: "", sources: [{ label: "自动抓取情报", ok: false, error: "disabled" }] }
      : await fetchMatchIntelligence(match);
    intelByMatch.push({ id: match.id, sources: intelligence.sources || [] });
    withIntel.push(describeFixture(match, intelligence.text));
  }

  const prompt = `请基于以下 FIFA 官方赛程和自动抓取情报，逐场输出预测表。输出 {"predictions":[...]}，只输出合法 JSON，不要 markdown。\n\n` +
    `要求：\n` +
    `1. 如果首发/伤停/市场基线没有抓到，必须明确降置信或 PASS。\n` +
    `2. 已经开赛或完赛的比赛不要假装赛前预测，标记为复盘/跳过组合，不得纳入 2/3/4 关。\n` +
    `3. 重点输出 safestDirection、parlaySafety、passRecommended、riskFlags。\n\n` +
    withIntel.join("\n\n---\n\n");
  return { prompt, intelByMatch };
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
    if (req.url === "/api/fixtures") {
      const loaded = await loadFixtures(body);
      send(res, 200, {
        source: FIFA_FIXTURES_URL,
        fetchedAt: new Date().toISOString(),
        sources: loaded.sources,
        fixtures: filterFixtures(loaded.fixtures, body)
      });
      return;
    }
    if (req.url === "/api/predict") {
      const prompt = buildMatchPrompt(body);
      const prediction = await callModel({ ...body, prompt });
      send(res, 200, { prediction });
      return;
    }
    if (req.url === "/api/predict-fixtures") {
      const { prompt, intelByMatch } = await buildFixturePrompt(body);
      const prediction = await callModel({ ...body, prompt });
      if (Array.isArray(prediction?.predictions)) {
        prediction.predictions = prediction.predictions.map((item, index) => ({
          ...item,
          dataSources: intelByMatch[index]?.sources || []
        }));
      }
      send(res, 200, { prediction, dataSources: intelByMatch });
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

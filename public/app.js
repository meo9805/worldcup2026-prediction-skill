let fixtures = [];
let predictions = [];
let currentPrediction = null;
let mode = "batch";
let hasServerApiKey = false;
let didAutoGenerate = false;

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5200);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.dataset.originalHtml ||= button.innerHTML;
  if (busy) button.textContent = label;
  if (!busy) button.innerHTML = button.dataset.originalHtml;
  if (window.lucide) window.lucide.createIcons();
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function legLabel(value) {
  return { core: "核心", helper: "辅助", avoid: "避开" }[value] || "-";
}

function statusLabel(status, fixture) {
  if (status === "finished") return `已完 ${fixture.scoreA}-${fixture.scoreB}`;
  if (status === "live") return `进行中 ${fixture.scoreA}-${fixture.scoreB} ${fixture.time || ""}`;
  return "未开赛";
}

function isPredictable(fixture) {
  return fixture.status === "scheduled";
}

function selectedFixtures() {
  const ids = [...document.querySelectorAll(".fixture-check:checked")].map((item) => item.value);
  return fixtures.filter((fixture) => ids.includes(fixture.id));
}

function renderFixtures() {
  const body = $("fixturesBody");
  body.innerHTML = "";

  if (!fixtures.length) {
    body.innerHTML = `<tr><td colspan="6" class="table-empty">没有读取到赛程</td></tr>`;
    return;
  }

  for (const fixture of fixtures) {
    const tr = document.createElement("tr");
    tr.className = fixture.status;
    tr.dataset.id = fixture.id;
    tr.innerHTML = `
      <td>
        <input class="fixture-check" type="checkbox" value="${fixture.id}" ${isPredictable(fixture) ? "checked" : ""} ${isPredictable(fixture) ? "" : "disabled"}>
      </td>
      <td>
        <strong>${fixture.date}</strong>
        <span>${fixture.time || "-"}</span>
      </td>
      <td>
        <strong>${fixture.teamAZh} vs ${fixture.teamBZh}</strong>
        <span>${fixture.teamA} vs ${fixture.teamB}</span>
      </td>
      <td>${fixture.group}</td>
      <td><span class="status ${fixture.status}">${statusLabel(fixture.status, fixture)}</span></td>
      <td>${fixture.city || fixture.stadium || "-"}</td>
    `;
    tr.addEventListener("click", (event) => {
      if (event.target.matches("input")) return;
      if (mode === "single" && isPredictable(fixture)) {
        document.querySelectorAll(".fixture-check").forEach((item) => item.checked = false);
        tr.querySelector(".fixture-check").checked = true;
      }
    });
    body.appendChild(tr);
  }
}

async function loadFixtures() {
  const button = $("refreshFixtures");
  try {
    setBusy(button, true, "刷新中...");
    const data = await postJson("/api/fixtures", {
      date: $("fixtureDate").value,
      window: Number($("fixtureWindow").value),
      includeFinished: $("includeFinished").checked
    });
    fixtures = data.fixtures || [];
    $("fixtureMeta").textContent = `已读取 ${fixtures.length} 场 · ${new Date(data.fetchedAt).toLocaleTimeString()}`;
    renderFixtures();
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function payloadBase() {
  return {
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "deepseek-chat",
    autoIntel: $("autoIntel").checked
  };
}

function normalizePredictions(data) {
  if (Array.isArray(data.prediction?.predictions)) return data.prediction.predictions;
  if (data.prediction?.match) return [data.prediction];
  return [];
}

async function generateBoard() {
  const button = $("generateBoard");
  try {
    const matches = selectedFixtures();
    if (!matches.length) throw new Error("没有选中可预测比赛。已完赛和进行中默认不会纳入预测。");
    const limited = mode === "single" ? matches.slice(0, 1) : matches.slice(0, 10);
    setBusy(button, true, $("autoIntel").checked ? "抓情报并生成..." : "生成中...");
    const data = await postJson("/api/predict-fixtures", {
      ...payloadBase(),
      matches: limited
    });
    predictions = normalizePredictions(data);
    renderPredictions(predictions);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function predictionCard(prediction, index) {
  const match = prediction.match || {};
  const probs = prediction.modelAdjusted || {};
  const safe = prediction.safestDirection || {};
  const parlay = prediction.parlaySafety || {};
  const div = document.createElement("article");
  div.className = `prediction-card grade-${String(parlay.grade || "").toLowerCase()}`;
  div.tabIndex = 0;
  div.innerHTML = `
    <div class="card-head">
      <div>
        <span>${match.stage || "小组赛"} · ${match.group || "-"}</span>
        <h3>${match.teamA || "-"} vs ${match.teamB || "-"}</h3>
      </div>
      <strong>等级 ${parlay.grade || "-"}</strong>
    </div>
    <div class="mini-probs">
      <span>${probs.teamAWin ?? "-"}%</span>
      <span>平 ${probs.draw ?? "-"}%</span>
      <span>${probs.teamBWin ?? "-"}%</span>
    </div>
    <div class="card-grid">
      <div><span>方向</span><strong>${safe.pick || "-"}</strong></div>
      <div><span>PASS</span><strong>${prediction.passRecommended ? "是" : "否"}</strong></div>
      <div><span>2/3/4关</span><strong>${legLabel(parlay.twoLeg)} / ${legLabel(parlay.threeLeg)} / ${legLabel(parlay.fourLeg)}</strong></div>
    </div>
    <p>${prediction.analysis || safe.reason || ""}</p>
    <ul>${(prediction.riskFlags || []).slice(0, 4).map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
  div.addEventListener("click", () => {
    currentPrediction = prediction;
    document.querySelectorAll(".prediction-card").forEach((item) => item.classList.remove("selected"));
    div.classList.add("selected");
    $("outputMeta").textContent = `已选择第 ${index + 1} 场作为复盘对象。`;
  });
  return div;
}

function renderPredictions(items) {
  $("emptyState").classList.add("hidden");
  $("boardResults").classList.remove("hidden");
  $("boardResults").innerHTML = "";
  if (!items.length) {
    $("boardResults").innerHTML = `<div class="table-empty">模型没有返回 predictions 数组。</div>`;
    return;
  }
  items.forEach((item, index) => $("boardResults").appendChild(predictionCard(item, index)));
  currentPrediction = items[0];
  $("outputMeta").textContent = `已生成 ${items.length} 场；点击卡片可做赛后复盘。`;
  document.querySelector(".prediction-card")?.classList.add("selected");
}

async function review() {
  if (!currentPrediction) {
    showToast("请先生成预测并选择一张卡片。");
    return;
  }
  try {
    const actualScore = $("actualScore").value.trim();
    const data = await postJson("/api/review", { prediction: currentPrediction, actualScore });
    const r = data.review;
    $("reviewOutput").innerHTML = `
      <div class="review-stat"><span>胜平负</span><strong>${r.outcomeHit ? "命中" : "未命中"}</strong></div>
      <div class="review-stat"><span>最稳方向</span><strong>${r.safestDirectionHit === null ? "需人工判定" : r.safestDirectionHit ? "命中" : "未命中"}</strong></div>
      <div class="review-stat"><span>Brier</span><strong>${r.brierScore}</strong></div>
      <div class="review-stat wide"><span>修正建议</span><strong>${r.nextAdjustmentSuggestion}</strong></div>
    `;
  } catch (error) {
    showToast(error.message);
  }
}

async function health() {
  try {
    const data = await postJson("/api/health", {});
    hasServerApiKey = Boolean(data.hasServerApiKey);
    $("serverStatus").textContent = data.hasServerApiKey ? "已配置 Key" : "需输入 Key";
  } catch {
    $("serverStatus").textContent = "连接失败";
  }
}

function bindControls() {
  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      if (mode === "single") {
        const first = document.querySelector(".fixture-check:not(:disabled)");
        document.querySelectorAll(".fixture-check").forEach((item) => item.checked = false);
        if (first) first.checked = true;
      } else {
        document.querySelectorAll(".fixture-check:not(:disabled)").forEach((item) => item.checked = true);
      }
    });
  });

  $("settingsBtn").addEventListener("click", () => $("settingsPanel").classList.toggle("hidden"));
  $("refreshFixtures").addEventListener("click", loadFixtures);
  $("fixtureDate").addEventListener("change", loadFixtures);
  $("fixtureWindow").addEventListener("change", loadFixtures);
  $("includeFinished").addEventListener("change", loadFixtures);
  $("generateBoard").addEventListener("click", generateBoard);
  $("reviewBtn").addEventListener("click", review);
  $("clearResults").addEventListener("click", () => {
    predictions = [];
    currentPrediction = null;
    $("boardResults").innerHTML = "";
    $("boardResults").classList.add("hidden");
    $("emptyState").classList.remove("hidden");
    $("outputMeta").textContent = "选择比赛后生成，批量模式会输出整张表。";
  });
  $("selectVisible").addEventListener("click", () => {
    document.querySelectorAll(".fixture-check:not(:disabled)").forEach((item) => item.checked = true);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindControls();
  await health();
  await loadFixtures();
  if (hasServerApiKey && fixtures.some(isPredictable)) {
    didAutoGenerate = true;
    await generateBoard();
  }
  if (window.lucide) window.lucide.createIcons();
});

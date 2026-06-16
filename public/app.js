let currentPrediction = null;

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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function formPayload() {
  const teamA = $("teamA").value.trim();
  const teamB = $("teamB").value.trim();
  if (!teamA || !teamB) throw new Error("请先填写两支队伍。");
  return {
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "deepseek-chat",
    stage: $("stage").value,
    group: $("group").value.trim(),
    kickoffBeijing: $("kickoff").value.trim(),
    teamA,
    teamB,
    realtime: $("realtime").value.trim()
  };
}

function pickPrediction(payload) {
  if (payload?.prediction?.predictions?.[0]) return payload.prediction.predictions[0];
  if (payload?.prediction?.match) return payload.prediction;
  return payload?.prediction;
}

function renderList(target, items, className) {
  target.className = className;
  target.innerHTML = "";
  for (const item of items || []) {
    const li = document.createElement("li");
    li.textContent = typeof item === "string" ? item : JSON.stringify(item);
    target.appendChild(li);
  }
}

function renderPrediction(prediction) {
  currentPrediction = prediction;
  $("emptyState").classList.add("hidden");
  $("resultView").classList.remove("hidden");

  const match = prediction.match || {};
  const probs = prediction.modelAdjusted || {};
  const safe = prediction.safestDirection || {};
  const parlay = prediction.parlaySafety || {};
  const teamA = match.teamA || "队伍 A";
  const teamB = match.teamB || "队伍 B";
  const a = Number(probs.teamAWin || 0);
  const d = Number(probs.draw || 0);
  const b = Number(probs.teamBWin || 0);

  $("matchMeta").textContent = `${match.stage || "未知阶段"} · ${match.group || "未知小组"} · ${match.kickoffBeijing || "未知时间"}`;
  $("matchTitle").textContent = `${teamA} vs ${teamB}`;
  $("gradeBadge").textContent = `等级 ${parlay.grade || "-"}`;
  $("gradeBadge").className = `grade-badge grade-${String(parlay.grade || "").toLowerCase()}`;

  const bar = document.querySelector(".probability-bar");
  bar.style.setProperty("--a", Math.max(a, 4) + "fr");
  bar.style.setProperty("--d", Math.max(d, 4) + "fr");
  bar.style.setProperty("--b", Math.max(b, 4) + "fr");
  $("probA").textContent = `${teamA} ${a}%`;
  $("probDraw").textContent = `平 ${d}%`;
  $("probB").textContent = `${teamB} ${b}%`;
  $("probLabels").innerHTML = `
    <span>${teamA}胜：${a}%</span>
    <span>平局：${d}%</span>
    <span>${teamB}胜：${b}%</span>
  `;

  $("safePick").textContent = safe.pick || "-";
  $("safeReason").textContent = safe.reason || "";
  $("passFlag").textContent = prediction.passRecommended ? "建议 PASS" : "可继续评估";
  $("passNote").textContent = prediction.passRecommended
    ? "不建议纳入组合，只适合单场讨论或等待更多实时信息。"
    : "仍需核对首发、伤停和市场基线后再判断。";
  $("legsText").textContent = `2关 ${legLabel(parlay.twoLeg)} · 3关 ${legLabel(parlay.threeLeg)} · 4关 ${legLabel(parlay.fourLeg)}`;
  $("legsNote").textContent = parlay.ruleNote || "组合关卡只做风险分层，不保证结果。";

  renderList($("riskFlags"), prediction.riskFlags || [], "chip-list");
  renderList($("keyFactors"), prediction.keyFactors || [], "plain-list");
  $("analysisText").textContent = prediction.analysis || "";
}

function legLabel(value) {
  return {
    core: "核心",
    helper: "辅助",
    avoid: "避开"
  }[value] || "-";
}

async function predict() {
  const button = $("predictBtn");
  try {
    setBusy(button, true, "生成中...");
    const payload = formPayload();
    const data = await postJson("/api/predict", payload);
    const prediction = pickPrediction(data);
    if (!prediction?.modelAdjusted) throw new Error("模型返回结构不完整。");
    renderPrediction(prediction);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

function batchItem(prediction) {
  const match = prediction.match || {};
  const parlay = prediction.parlaySafety || {};
  const safe = prediction.safestDirection || {};
  const div = document.createElement("div");
  div.className = "batch-item";
  div.innerHTML = `
    <strong>${match.teamA || "-"} vs ${match.teamB || "-"}</strong>
    <div>方向：${safe.pick || "-"} · 等级：${parlay.grade || "-"} · PASS：${prediction.passRecommended ? "是" : "否"}</div>
    <div>2关 ${legLabel(parlay.twoLeg)} / 3关 ${legLabel(parlay.threeLeg)} / 4关 ${legLabel(parlay.fourLeg)}</div>
  `;
  return div;
}

async function batchPredict() {
  const button = $("batchBtn");
  try {
    setBusy(button, true, "批量生成中...");
    const data = await postJson("/api/batch", {
      apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim() || "deepseek-chat",
      matches: $("batchMatches").value,
      realtime: $("realtime").value.trim()
    });
    const predictions = data.prediction?.predictions || [];
    $("batchResults").innerHTML = "";
    for (const item of predictions) $("batchResults").appendChild(batchItem(item));
    if (!predictions.length) showToast("模型没有返回 predictions 数组。");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(button, false);
  }
}

async function review() {
  if (!currentPrediction) {
    showToast("请先生成一场预测。");
    return;
  }
  try {
    const actualScore = $("actualScore").value.trim();
    const data = await postJson("/api/review", { prediction: currentPrediction, actualScore });
    const r = data.review;
    $("reviewOutput").innerHTML = `
      <div class="review-stat"><span>胜平负命中</span><strong>${r.outcomeHit ? "命中" : "未命中"}</strong></div>
      <div class="review-stat"><span>最稳方向</span><strong>${r.safestDirectionHit === null ? "需人工判定" : r.safestDirectionHit ? "命中" : "未命中"}</strong></div>
      <div class="review-stat"><span>Brier Score</span><strong>${r.brierScore}</strong></div>
      <div class="review-stat"><span>修正建议</span><strong>${r.nextAdjustmentSuggestion}</strong></div>
    `;
  } catch (error) {
    showToast(error.message);
  }
}

async function health() {
  try {
    const data = await postJson("/api/health", {});
    $("serverStatus").textContent = data.hasServerApiKey ? "已配置 Key" : "需输入 Key";
  } catch {
    $("serverStatus").textContent = "连接失败";
  }
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      $(`tab-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

function fillSample() {
  $("group").value = "H";
  $("kickoff").value = "2026-06-16 00:00";
  $("teamA").value = "西班牙";
  $("teamB").value = "佛得角";
  $("realtime").value = "未提供首发、伤停、市场基线、天气。请按缺少关键实时数据处理，必须考虑 PASS。";
}

document.addEventListener("DOMContentLoaded", () => {
  bindTabs();
  $("predictBtn").addEventListener("click", predict);
  $("batchBtn").addEventListener("click", batchPredict);
  $("reviewBtn").addEventListener("click", review);
  $("fillSample").addEventListener("click", fillSample);
  fillSample();
  health();
  if (window.lucide) window.lucide.createIcons();
});

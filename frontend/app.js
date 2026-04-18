"use strict";

const API = "http://127.0.0.1:8765";

// ── Elements ──────────────────────────────────────────────────────────────────
const statusDot    = document.getElementById("statusDot");
const statusText   = document.getElementById("statusText");
const librarySelect = document.getElementById("librarySelect");
const queryInput   = document.getElementById("queryInput");
const searchBtn    = document.getElementById("searchBtn");
const modeSelect   = document.getElementById("modeSelect");
const topKInput    = document.getElementById("topKInput");
const rerankCheck  = document.getElementById("rerankCheck");
const resultsSection = document.getElementById("resultsSection");
const resultsHeader  = document.getElementById("resultsHeader");
const resultsList    = document.getElementById("resultsList");
const emptyState     = document.getElementById("emptyState");

// ── Service health check ──────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const r = await fetch(`${API}/v1/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error();
    const data = await r.json();
    statusDot.className = "dot ok";
    statusText.textContent = data.cuda_device
      ? `Ready · ${data.cuda_device}`
      : "Ready (CPU)";
  } catch {
    statusDot.className = "dot err";
    statusText.textContent = "Service offline";
  }
}

// ── Load library list ─────────────────────────────────────────────────────────
async function loadLibraries() {
  try {
    const r = await fetch(`${API}/v1/libraries`);
    if (!r.ok) return;
    const { libraries } = await r.json();
    librarySelect.innerHTML = '<option value="">All libraries</option>';
    for (const lib of libraries) {
      const opt = document.createElement("option");
      opt.value = lib.library_name;
      opt.textContent = `${lib.library_name} (${lib.chunk_count ?? "?"} chunks)`;
      librarySelect.appendChild(opt);
    }
  } catch { /* service not up yet */ }
}

// ── Search ────────────────────────────────────────────────────────────────────
async function runSearch() {
  const query = queryInput.value.trim();
  if (!query) return;

  searchBtn.disabled = true;
  searchBtn.innerHTML = '<span class="spinner"></span>';
  resultsList.innerHTML = "";
  resultsSection.classList.add("hidden");
  emptyState.classList.add("hidden");

  try {
    const body = {
      query,
      library: librarySelect.value || null,
      mode:    modeSelect.value,
      top_k:   parseInt(topKInput.value, 10) || 5,
      rerank:  rerankCheck.checked,
    };
    const r = await fetch(`${API}/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || r.statusText);
    }
    const data = await r.json();
    renderResults(data);
  } catch (e) {
    resultsHeader.textContent = `Error: ${e.message}`;
    resultsSection.classList.remove("hidden");
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Search";
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResults(data) {
  const results = data.results || [];
  if (results.length === 0) {
    resultsHeader.textContent = "No results found.";
    resultsSection.classList.remove("hidden");
    return;
  }

  resultsHeader.textContent =
    `${results.length} result${results.length !== 1 ? "s" : ""} · mode: ${data.mode}` +
    (data.rerank ? " · reranked" : "");

  resultsList.innerHTML = results.map(r => {
    const scores = r.scores || {};
    const badgeHtml = [
      scores.rerank  != null ? `<span class="score-badge">rerank <span>${scores.rerank.toFixed(3)}</span></span>` : "",
      scores.initial != null ? `<span class="score-badge">initial <span>${scores.initial.toFixed(3)}</span></span>` : "",
      scores.vector  != null ? `<span class="score-badge">vector <span>${scores.vector.toFixed(3)}</span></span>` : "",
      scores.bm25    != null ? `<span class="score-badge">bm25 <span>${scores.bm25.toFixed(3)}</span></span>` : "",
    ].filter(Boolean).join("");

    return `
      <div class="result-card">
        <div class="result-meta">
          <span class="result-rank">#${r.rank}</span>
          <a class="result-url" href="${esc(r.source_url)}" target="_blank" rel="noopener">${esc(r.source_url)}</a>
          <span class="result-lib">${esc(r.library_name)}</span>
        </div>
        <div class="result-content">${esc(r.content)}</div>
        <div class="result-scores">${badgeHtml}</div>
      </div>`;
  }).join("");

  resultsSection.classList.remove("hidden");
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── JSON export (Claude Code / Codex compatibility) ───────────────────────────
// Adding a global helper so agents can call BadgerAI.search(query) from the browser console
// and receive a JSON object matching the same schema as `plshelp query --json`.
window.BadgerAI = {
  async search(query, options = {}) {
    const body = {
      query,
      library: options.library ?? null,
      mode:    options.mode    ?? "hybrid",
      top_k:   options.top_k  ?? 5,
      rerank:  options.rerank  ?? true,
    };
    const r = await fetch(`${API}/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  },
  async libraries() {
    const r = await fetch(`${API}/v1/libraries`);
    return r.json();
  },
};

// ── Event listeners ───────────────────────────────────────────────────────────
searchBtn.addEventListener("click", runSearch);
queryInput.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

// ── Init ──────────────────────────────────────────────────────────────────────
checkHealth();
loadLibraries();
setInterval(checkHealth, 15_000);

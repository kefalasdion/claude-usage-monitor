'use strict';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const stateLoading = document.getElementById('state-loading');
const stateData    = document.getElementById('state-data');
const elPlanName   = document.getElementById('plan-name');
const elUsed       = document.getElementById('used');
const elLimit      = document.getElementById('limit');
const elBar        = document.getElementById('progress-bar');
const elPct        = document.getElementById('progress-pct');
const elResetsAt   = document.getElementById('resets-at');
const elUpdatedAt  = document.getElementById('updated-at');
const btnRefresh   = document.getElementById('btn-refresh');

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d - now;

    if (diffMs > 0) {
      const h = Math.floor(diffMs / 3_600_000);
      const m = Math.floor((diffMs % 3_600_000) / 60_000);
      if (h > 0) return `in ${h}h ${m}m`;
      return `in ${m}m`;
    }
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return iso;
  }
}

function formatUpdated(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return iso;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(usage) {
  if (!usage || (usage.used == null && usage.limit == null)) {
    stateLoading.classList.remove('hidden');
    stateData.classList.add('hidden');
    return;
  }

  stateLoading.classList.add('hidden');
  stateData.classList.remove('hidden');

  elPlanName.textContent = usage.planName || 'Claude';

  const used  = usage.used  ?? '—';
  const limit = usage.limit ?? '—';
  elUsed.textContent  = used;
  elLimit.textContent = limit;

  const p = (usage.used != null && usage.limit != null) ? pct(usage.used, usage.limit) : 0;
  elPct.textContent   = `${p}%`;
  elBar.style.width   = `${p}%`;
  elBar.className     = 'progress-bar';
  if (p >= 90)      elBar.classList.add('red');
  else if (p >= 70) elBar.classList.add('amber');

  elResetsAt.textContent  = formatTime(usage.resetsAt);
  elUpdatedAt.textContent = formatUpdated(usage.updatedAt);
}

// ── Load stored data ──────────────────────────────────────────────────────────

function loadUsage() {
  chrome.runtime.sendMessage({ type: 'GET_USAGE' }, (response) => {
    if (chrome.runtime.lastError) {
      render(null);
      return;
    }
    render(response?.usage || null);
  });
}

// ── Refresh button ────────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', async () => {
  btnRefresh.disabled = true;
  btnRefresh.textContent = '…';

  // Ask all claude.ai tabs to probe immediately
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  const probes = tabs.map((tab) =>
    chrome.tabs.sendMessage(tab.id, { type: 'PROBE_NOW' }).catch(() => {})
  );
  await Promise.all(probes);

  // Give the content script a moment to respond then reload from storage
  setTimeout(() => {
    loadUsage();
    btnRefresh.disabled = false;
    btnRefresh.textContent = '↻ Refresh';
  }, 1500);
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadUsage();

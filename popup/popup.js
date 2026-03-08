'use strict';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const stateLoading  = document.getElementById('state-loading');
const stateData     = document.getElementById('state-data');
const elPlanName    = document.getElementById('plan-name');

const elPct5h       = document.getElementById('pct-5h');
const elBar5h       = document.getElementById('bar-5h');
const elReset5h     = document.getElementById('reset-5h');

const elPct7d       = document.getElementById('pct-7d');
const elBar7d       = document.getElementById('bar-7d');
const elReset7d     = document.getElementById('reset-7d');

const sonnetBlock   = document.getElementById('sonnet-block');
const elPctSonnet   = document.getElementById('pct-sonnet');
const elBarSonnet   = document.getElementById('bar-sonnet');
const elResetSonnet = document.getElementById('reset-sonnet');

const elUpdatedAt   = document.getElementById('updated-at');
const btnRefresh    = document.getElementById('btn-refresh');

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyBar(barEl, pct) {
  barEl.style.width = `${Math.min(100, pct)}%`;
  barEl.className   = 'progress-bar';
  if (pct >= 90)      barEl.classList.add('red');
  else if (pct >= 70) barEl.classList.add('amber');
}

function formatReset(iso) {
  if (!iso) return '—';
  try {
    const d   = new Date(iso);
    const now = new Date();
    const ms  = d - now;
    if (ms <= 0) return 'soon';
    const h   = Math.floor(ms / 3_600_000);
    const m   = Math.floor((ms % 3_600_000) / 60_000);
    if (h >= 24) {
      const days = Math.floor(h / 24);
      return `in ${days}d ${h % 24}h`;
    }
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  } catch (_) {
    return '—';
  }
}

function formatUpdated(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch (_) { return '—'; }
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(usage) {
  const has5h = usage?.fiveHour?.utilization != null;
  const has7d = usage?.sevenDay?.utilization != null;

  if (!usage || (!has5h && !has7d)) {
    stateLoading.classList.remove('hidden');
    stateData.classList.add('hidden');
    return;
  }

  stateLoading.classList.add('hidden');
  stateData.classList.remove('hidden');

  elPlanName.textContent = usage.planName || 'Claude';

  // 5-hour window
  if (has5h) {
    const p = Math.round(usage.fiveHour.utilization);
    elPct5h.textContent = `${p}%`;
    applyBar(elBar5h, p);
    elReset5h.textContent = formatReset(usage.fiveHour.resetsAt);
  }

  // 7-day window
  if (has7d) {
    const p = Math.round(usage.sevenDay.utilization);
    elPct7d.textContent = `${p}%`;
    applyBar(elBar7d, p);
    elReset7d.textContent = formatReset(usage.sevenDay.resetsAt);
  }

  // 7-day Sonnet (optional)
  const hasSonnet = usage.sevenDaySonnet?.utilization != null;
  sonnetBlock.style.display = hasSonnet ? '' : 'none';
  if (hasSonnet) {
    const p = Math.round(usage.sevenDaySonnet.utilization);
    elPctSonnet.textContent = `${p}%`;
    applyBar(elBarSonnet, p);
    elResetSonnet.textContent = formatReset(usage.sevenDaySonnet.resetsAt);
  }

  elUpdatedAt.textContent = formatUpdated(usage.updatedAt);
}

// ── Load from storage ─────────────────────────────────────────────────────────

function loadUsage() {
  chrome.runtime.sendMessage({ type: 'GET_USAGE' }, (response) => {
    if (chrome.runtime.lastError) { render(null); return; }
    render(response?.usage || null);
  });
}

// ── Refresh button ────────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', async () => {
  btnRefresh.disabled     = true;
  btnRefresh.textContent  = '…';

  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  await Promise.all(
    tabs.map((t) => chrome.tabs.sendMessage(t.id, { type: 'PROBE_NOW' }).catch(() => {}))
  );

  setTimeout(() => {
    loadUsage();
    btnRefresh.disabled    = false;
    btnRefresh.textContent = '↻ Refresh';
  }, 1800);
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadUsage();

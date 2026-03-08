/**
 * Background service worker (Manifest V3).
 *
 * Data shape stored in chrome.storage.local:
 * {
 *   claudeUsage: {
 *     planName:   "Claude Max 5×",
 *     fiveHour:   { utilization: 46, resetsAt: "2026-03-08T21:00:00Z" },
 *     sevenDay:   { utilization: 20, resetsAt: "2026-03-13T07:00:00Z" },
 *     sevenDaySonnet: { utilization: 4, resetsAt: "..." } | undefined,
 *     updatedAt:  "2026-03-08T19:34:00Z"
 *   }
 * }
 */

'use strict';

const STORAGE_KEY = 'claudeUsage';
const ALARM_NAME  = 'claudeUsageRefresh';

// ── Badge helpers ────────────────────────────────────────────────────────────

function badgeColor(pct) {
  if (pct == null) return '#888888';
  if (pct >= 90)   return '#e53935'; // red
  if (pct >= 70)   return '#fb8c00'; // amber
  return '#43a047';                   // green
}

function updateBadge(usage) {
  if (!usage || usage.fiveHour?.utilization == null) {
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
    chrome.action.setTitle({ title: 'Claude Usage Monitor — waiting for data' });
    return;
  }

  const pct  = Math.round(usage.fiveHour.utilization);
  const text = pct >= 100 ? 'MAX' : `${pct}%`;

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: badgeColor(pct) });
  chrome.action.setTitle({
    title: `Claude Usage\n5-hour: ${pct}%  |  7-day: ${Math.round(usage.sevenDay?.utilization ?? 0)}%`
  });
}

// ── Persist usage ────────────────────────────────────────────────────────────

async function saveUsage(partial) {
  // Merge with existing record so PLAN_NAME and USAGE_DATA messages can
  // arrive independently without overwriting each other.
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const prev   = stored[STORAGE_KEY] || {};
  const record = { ...prev, ...partial, updatedAt: new Date().toISOString() };

  await chrome.storage.local.set({ [STORAGE_KEY]: record });
  updateBadge(record);
}

// ── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'USAGE_DATA' && msg.payload) {
    saveUsage(msg.payload);
    sendResponse({ ok: true });
  }

  if (msg.type === 'PLAN_NAME' && msg.payload) {
    saveUsage({ planName: msg.payload });
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_USAGE') {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      sendResponse({ usage: result[STORAGE_KEY] || null });
    });
    return true; // async sendResponse
  }
});

// ── Alarm: prod all claude.ai tabs every 60 s ────────────────────────────────

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'PROBE_NOW' }).catch(() => {});
  }
});

// ── Restore badge on startup ─────────────────────────────────────────────────

async function restoreBadge() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  updateBadge(result[STORAGE_KEY] || null);
}

chrome.runtime.onInstalled.addListener(restoreBadge);
chrome.runtime.onStartup.addListener(restoreBadge);

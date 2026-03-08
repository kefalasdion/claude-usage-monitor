/**
 * Background service worker (Manifest V3).
 *
 * Responsibilities:
 *  - Receive USAGE_DATA messages from the content script.
 *  - Persist the latest usage to chrome.storage.local.
 *  - Update the toolbar badge (colour + text).
 *  - Set an alarm to probe every 60 s even when no message arrives.
 */

'use strict';

const STORAGE_KEY = 'claudeUsage';
const ALARM_NAME  = 'claudeUsageRefresh';
const PROBE_MSG   = { type: 'PROBE_NOW' };

// ── Badge helpers ────────────────────────────────────────────────────────────

function pct(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function badgeColor(percentage) {
  if (percentage >= 90) return '#e53935'; // red
  if (percentage >= 70) return '#fb8c00'; // amber
  return '#43a047';                        // green
}

function updateBadge(usage) {
  if (!usage) {
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
    return;
  }

  const { used, limit } = usage;

  if (used == null || limit == null) {
    chrome.action.setBadgeText({ text: '—' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
    return;
  }

  const p = pct(used, limit);
  const text = p >= 100 ? 'MAX' : `${p}%`;

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: badgeColor(p) });
  chrome.action.setTitle({ title: `Claude Usage: ${used}/${limit} messages (${p}%)` });
}

// ── Persist and broadcast usage ──────────────────────────────────────────────

async function saveUsage(usage) {
  const record = {
    ...usage,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: record });
  updateBadge(record);
}

// ── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'USAGE_DATA' && msg.payload) {
    saveUsage(msg.payload);
    sendResponse({ ok: true });
  }
  if (msg.type === 'GET_USAGE') {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      sendResponse({ usage: result[STORAGE_KEY] || null });
    });
    return true; // keep channel open for async sendResponse
  }
});

// ── Alarm: probe active claude.ai tabs every 60 s ────────────────────────────

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, PROBE_MSG).catch(() => {});
  }
});

// ── On install / startup: restore badge from storage ─────────────────────────

async function restoreBadge() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  updateBadge(result[STORAGE_KEY] || null);
}

chrome.runtime.onInstalled.addListener(restoreBadge);
chrome.runtime.onStartup.addListener(restoreBadge);

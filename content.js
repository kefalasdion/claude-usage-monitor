/**
 * Content script injected into claude.ai pages.
 *
 * Strategy:
 *  1. Intercept fetch/XHR responses that contain usage/limit data.
 *  2. Parse and forward the data to the background service worker.
 *  3. Also trigger a manual fetch of the usage endpoint when the page loads
 *     and every 60 seconds while the tab is active.
 */

(() => {
  'use strict';

  // Known endpoint patterns that carry usage data on claude.ai
  const USAGE_PATTERNS = [
    /\/api\/organizations\/[^/]+\/usage/,
    /\/api\/organizations\/[^/]+\/limits/,
    /\/api\/usage/,
    /\/api\/account\/usage/,
    /\/api\/bootstrap/,
    /\/api\/auth\/session/,
  ];

  // ── Intercept fetch ─────────────────────────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (USAGE_PATTERNS.some((p) => p.test(url))) {
        const clone = response.clone();
        clone.json().then((data) => {
          forwardToBackground(url, data);
        }).catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  // ── Intercept XMLHttpRequest ─────────────────────────────────────────────
  const OriginalXHR = window.XMLHttpRequest;
  class PatchedXHR extends OriginalXHR {
    open(method, url, ...rest) {
      this._monitorUrl = url;
      super.open(method, url, ...rest);
    }
    send(...args) {
      if (this._monitorUrl && USAGE_PATTERNS.some((p) => p.test(this._monitorUrl))) {
        this.addEventListener('load', () => {
          try {
            const data = JSON.parse(this.responseText);
            forwardToBackground(this._monitorUrl, data);
          } catch (_) {}
        });
      }
      super.send(...args);
    }
  }
  window.XMLHttpRequest = PatchedXHR;

  // ── Forward parsed data to background ───────────────────────────────────
  function forwardToBackground(url, data) {
    const usage = extractUsage(url, data);
    if (usage) {
      chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: usage }).catch(() => {});
    }
  }

  // ── Extract usage fields from various response shapes ───────────────────
  function extractUsage(url, data) {
    if (!data || typeof data !== 'object') return null;

    // Shape 1: { messageLimit: { used, limit, resetsAt }, plan: { name } }
    if (data.messageLimit || data.message_limit) {
      const ml = data.messageLimit || data.message_limit;
      return {
        planName: data.plan?.name || data.planName || data.plan_name || null,
        used: ml.used ?? ml.messagesUsed ?? null,
        limit: ml.limit ?? ml.messageLimit ?? ml.maxMessages ?? null,
        resetsAt: ml.resetsAt ?? ml.resetAt ?? ml.reset_at ?? null,
        raw: { url, data },
      };
    }

    // Shape 2: array of usage objects
    if (Array.isArray(data)) {
      for (const item of data) {
        const result = extractUsage(url, item);
        if (result) return result;
      }
    }

    // Shape 3: nested under account/limits/usage keys
    for (const key of ['account', 'limits', 'usage', 'rateLimits', 'rate_limits']) {
      if (data[key]) {
        const result = extractUsage(url, data[key]);
        if (result) return result;
      }
    }

    // Shape 4: flat { used, limit, resetsAt } with numeric used/limit
    if (
      typeof data.used === 'number' &&
      typeof data.limit === 'number'
    ) {
      return {
        planName: data.planName || data.plan?.name || null,
        used: data.used,
        limit: data.limit,
        resetsAt: data.resetsAt || data.resetAt || data.reset_at || null,
        raw: { url, data },
      };
    }

    return null;
  }

  // ── Active probing: fetch the usage endpoint directly ───────────────────
  async function probeUsage() {
    try {
      // Determine the org ID from the page URL or from a stored bootstrap call
      const orgMatch = window.location.pathname.match(/\/orgs?\/([\w-]+)/);
      let orgId = orgMatch?.[1];

      // Fallback: try to find it from the page's react/redux state or meta
      if (!orgId) {
        const metaOrg = document.querySelector('meta[name="org-id"]');
        orgId = metaOrg?.content;
      }

      if (!orgId) return; // Can't determine org — wait for intercepted responses

      const endpoints = [
        `/api/organizations/${orgId}/usage`,
        `/api/organizations/${orgId}/limits`,
      ];

      for (const path of endpoints) {
        const resp = await fetch(`https://claude.ai${path}`, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (resp.ok) {
          const data = await resp.json();
          forwardToBackground(path, data);
          break;
        }
      }
    } catch (_) {}
  }

  // Also listen for messages from the background (on-demand refresh)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PROBE_NOW') probeUsage();
  });

  // Initial probe after the page settles
  setTimeout(probeUsage, 2000);

  // ── Auto-refresh every 60 seconds while this tab is active ──────────────
  let probeInterval = null;

  function startProbing() {
    if (probeInterval) return;
    probeInterval = setInterval(probeUsage, 60_000);
  }

  function stopProbing() {
    if (probeInterval) {
      clearInterval(probeInterval);
      probeInterval = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startProbing();
      probeUsage(); // immediate refresh on tab focus
    } else {
      stopProbing();
    }
  });

  if (document.visibilityState === 'visible') startProbing();
})();

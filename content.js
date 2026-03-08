/**
 * Content script injected into claude.ai pages.
 *
 * Real API (discovered by inspection):
 *   GET /api/organizations/{orgId}/usage
 *   → { five_hour: { utilization: 46, resets_at: "..." },
 *        seven_day: { utilization: 20, resets_at: "..." },
 *        seven_day_sonnet: { utilization: 4, resets_at: "..." }, ... }
 *
 *   GET /api/organizations/{orgId}/rate_limits
 *   → { rate_limit_tier: "default_claude_max_5x", ... }
 *
 * Strategy:
 *  1. Intercept every fetch/XHR to extract the org UUID from the URL.
 *  2. Once we have the org UUID, directly fetch the usage + rate_limits endpoints.
 *  3. Forward parsed data to the background service worker.
 *  4. Re-probe every 60 s while the tab is visible.
 */

(() => {
  'use strict';

  let orgId = null;           // discovered from intercepted URLs
  let probeInterval = null;

  // ── Extract org UUID from any API URL ───────────────────────────────────
  const ORG_RE = /\/api\/organizations\/([\w-]{36})\//;

  function tryExtractOrgId(url) {
    if (orgId) return;
    const m = (typeof url === 'string' ? url : '').match(ORG_RE);
    if (m) {
      orgId = m[1];
      // Immediately probe now that we have the ID
      probeUsage();
    }
  }

  // ── Patch fetch ─────────────────────────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    tryExtractOrgId(url);

    const response = await originalFetch.apply(this, args);

    // Also capture the usage response directly if we happen to intercept it
    if (/\/api\/organizations\/[\w-]+\/usage/.test(url) && response.ok) {
      response.clone().json().then((data) => {
        handleUsageResponse(data);
      }).catch(() => {});
    }

    return response;
  };

  // ── Patch XMLHttpRequest ────────────────────────────────────────────────
  const OriginalXHR = window.XMLHttpRequest;
  class PatchedXHR extends OriginalXHR {
    open(method, url, ...rest) {
      this._url = url;
      tryExtractOrgId(url);
      super.open(method, url, ...rest);
    }
    send(...args) {
      if (this._url && /\/api\/organizations\/[\w-]+\/usage/.test(this._url)) {
        this.addEventListener('load', () => {
          try { handleUsageResponse(JSON.parse(this.responseText)); } catch (_) {}
        });
      }
      super.send(...args);
    }
  }
  window.XMLHttpRequest = PatchedXHR;

  // ── Parse the real usage response shape ─────────────────────────────────
  function handleUsageResponse(data) {
    if (!data || typeof data !== 'object') return;

    const toWindow = (w) => w
      ? { utilization: w.utilization ?? null, resetsAt: w.resets_at ?? null }
      : null;

    const payload = {
      fiveHour:     toWindow(data.five_hour),
      sevenDay:     toWindow(data.seven_day),
      sevenDaySonnet: toWindow(data.seven_day_sonnet) || undefined,
    };

    // Only send if we have at least one real value
    if (payload.fiveHour?.utilization != null || payload.sevenDay?.utilization != null) {
      chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload }).catch(() => {});
    }
  }

  // ── Direct probe of the usage endpoint ─────────────────────────────────
  async function probeUsage() {
    if (!orgId) return;
    try {
      const [uResp, rlResp] = await Promise.all([
        fetch(`/api/organizations/${orgId}/usage`,       { credentials: 'include' }),
        fetch(`/api/organizations/${orgId}/rate_limits`, { credentials: 'include' }),
      ]);

      let planName = null;
      if (rlResp.ok) {
        const rl = await rlResp.json();
        planName = parseTierName(rl.rate_limit_tier);
      }

      if (uResp.ok) {
        const data = await uResp.json();
        handleUsageResponse(data);

        // Attach plan name via a second message if we got it
        if (planName) {
          chrome.runtime.sendMessage({ type: 'PLAN_NAME', payload: planName }).catch(() => {});
        }
      }
    } catch (_) {}
  }

  // ── Turn "default_claude_max_5x" → "Claude Max 5×" ─────────────────────
  function parseTierName(tier) {
    if (!tier) return null;
    // e.g. "default_claude_max_5x" → "Claude Max 5×"
    //      "default_claude_pro"    → "Claude Pro"
    //      "default_claude_free"   → "Claude Free"
    const cleaned = tier
      .replace(/^default_/, '')          // strip "default_"
      .replace(/_(\d+)x$/, ' $1×')      // "_5x" → " 5×"
      .replace(/_/g, ' ')               // remaining underscores → spaces
      .replace(/\bclaude\b/gi, 'Claude') // capitalise Claude
      .replace(/\bmax\b/gi, 'Max')
      .replace(/\bpro\b/gi, 'Pro')
      .replace(/\bfree\b/gi, 'Free')
      .replace(/\bteam\b/gi, 'Team')
      .trim();
    return cleaned;
  }

  // ── Listen for on-demand probes from the background ─────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PROBE_NOW') probeUsage();
  });

  // ── Auto-refresh every 60 s while tab is visible ────────────────────────
  function startProbing() {
    if (probeInterval) return;
    probeInterval = setInterval(probeUsage, 60_000);
  }
  function stopProbing() {
    clearInterval(probeInterval);
    probeInterval = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startProbing();
      probeUsage();
    } else {
      stopProbing();
    }
  });

  if (document.visibilityState === 'visible') startProbing();

  // Initial attempt: if orgId isn't in a URL yet, try after DOM settles
  setTimeout(() => {
    if (!orgId) {
      // Last resort: try to find org ID in the page's JS globals
      try {
        const scripts = [...document.querySelectorAll('script')];
        for (const s of scripts) {
          const m = s.textContent.match(/"uuid"\s*:\s*"([\w-]{36})"/);
          if (m) { orgId = m[1]; probeUsage(); break; }
        }
      } catch (_) {}
    } else {
      probeUsage();
    }
  }, 2500);
})();

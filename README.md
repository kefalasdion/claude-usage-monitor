# Claude Usage Monitor

A Chrome extension (Manifest V3) that displays your **Claude.ai message usage limits** directly in the Chrome toolbar — no API key required.

![Badge showing usage percentage in toolbar](icons/icon48.png)

---

## What it does

| Feature | Detail |
|---|---|
| **Toolbar badge** | Shows your current usage as a percentage, colour-coded green / amber / red |
| **Popup** | Displays plan name, messages used vs limit, reset time, and a progress bar |
| **Auto-refresh** | Polls every 60 seconds while a `claude.ai` tab is open and visible |
| **Zero config** | Reads directly from your authenticated Claude session — no API key, no tokens |

### Badge colours

| Colour | Meaning |
|---|---|
| Green | < 70 % used |
| Amber | 70 – 90 % used |
| Red | > 90 % used |

---

## Requirements

- Google Chrome (or any Chromium-based browser supporting MV3)
- An active, **logged-in** session on [claude.ai](https://claude.ai)

---

## Installation (Developer Mode)

1. **Download or clone this repo**

   ```bash
   git clone https://github.com/kefalasdion/claude-usage-monitor.git
   ```

2. **Open Chrome Extensions**

   Navigate to `chrome://extensions/` in your browser.

3. **Enable Developer Mode**

   Toggle the **Developer mode** switch in the top-right corner.

4. **Load the extension**

   Click **Load unpacked** and select the `claude-usage-monitor` folder (the one containing `manifest.json`).

5. **Pin the extension** *(optional but recommended)*

   Click the puzzle-piece icon in the toolbar → find *Claude Usage Monitor* → click the pin icon.

6. **Open claude.ai**

   Navigate to [claude.ai](https://claude.ai) and log in. Within a few seconds the badge will update with your current usage.

---

## How it works

```
claude.ai tab                 background.js          popup.js
     │                              │                    │
     │  intercept fetch/XHR         │                    │
     │  for usage endpoints ──────► │                    │
     │                    sendMessage(USAGE_DATA)         │
     │                              │ store in            │
     │                              │ chrome.storage      │
     │                              │ update badge        │
     │  ◄── PROBE_NOW (alarm) ──── │                    │
     │                              │  ◄── GET_USAGE ── │
     │                              │ ──────────────────►│
     │                              │    render popup    │
```

1. **`content.js`** patches `window.fetch` and `XMLHttpRequest` in every `claude.ai` tab to intercept usage-data responses. It also probes known API endpoints directly.
2. **`background.js`** receives parsed usage data, persists it to `chrome.storage.local`, updates the badge, and fires a 60-second alarm to trigger fresh probes.
3. **`popup.js`** reads from storage and renders the UI each time the popup opens.

---

## File structure

```
claude-usage-monitor/
├── manifest.json        # Extension manifest (MV3)
├── background.js        # Service worker — storage, badge, alarms
├── content.js           # Injected into claude.ai — intercepts usage data
├── popup/
│   ├── popup.html       # Popup markup
│   ├── popup.js         # Popup logic
│   └── popup.css        # Dark-themed styles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Badge shows `?` | Make sure you are logged in to claude.ai and have at least one tab open |
| Data doesn't update | Click **↻ Refresh** in the popup, or reload the claude.ai tab |
| Wrong usage shown | Claude may have changed their API endpoints — open an issue |

---

## Privacy

This extension runs entirely locally. No data is ever sent to any external server. It only reads from your own authenticated Claude session within your browser.

---

## Contributing

Pull requests are welcome. If Claude changes their internal API shape, please open an issue with the new network response so the parser can be updated.

---

## License

MIT

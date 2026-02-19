# CS2 2D Demo Viewer Faceit Bridge (Chrome Extension)

This extension adds a **View 2D Demo** button in Faceit match rooms when the **Watch demo** button is present.

## What it does

1. Detects **Watch demo** on Faceit match room pages.
2. Adds **View 2D Demo** next to it.
3. Resolves the final demo archive URL.
4. Opens the main CS2 2D Demo Viewer with `?demoArchiveUrl=...`.
5. Provides a secure extension bridge so the viewer can proxy archive downloads and avoid Faceit/CORS blocking.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:
   - `extensions/faceit-demo-bridge`

## Optional configuration

By default, the extension opens:
- `https://yerevin.github.io/cs2-2d-demoviewer/`

You can override it in DevTools console on any page:

```js
chrome.storage.sync.set({ viewerUrl: "http://localhost:3000/" });
```

## Security notes

- URL handling is restricted to `http/https` only.
- Cross-origin archive fetch is performed in the extension background service worker (with explicit host permissions), not in Faceit page context.
- Archive bytes are stored in temporary in-memory cache and removed after transfer / TTL.

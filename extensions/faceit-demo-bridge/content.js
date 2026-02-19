const VIEWER_DEFAULT_URL = "https://yerevin.github.io/cs2-2d-demoviewer/";
const FACEIT_HOST_PATTERN = /(^|\.)faceit\.com$/i;
const BRIDGE_REQUEST_SOURCE = "CS2DV_VIEWER";
const BRIDGE_RESPONSE_SOURCE = "CS2DV_EXTENSION";
const BRIDGE_BUTTON_ID = "cs2dv-view-2d-demo-btn";

const isFaceitPage = () => FACEIT_HOST_PATTERN.test(window.location.hostname);
const isViewerPage = () =>
  window.location.hostname === "localhost" ||
  window.location.hostname === "yerevin.github.io";

// store last download_url observed from Faceit API (posted from page hook)
let _lastFaceitDownload = { url: null, ts: 0 };

// receive messages from injected page hook (see injectFetchHook)
window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== "CS2DV_FACEIT_HOOK") return;
  if (d.download_url) {
    _lastFaceitDownload = { url: d.download_url, ts: Date.now() };
    // keep only a short-lived cached value
    setTimeout(() => {
      if (Date.now() - _lastFaceitDownload.ts > 30_000) _lastFaceitDownload = { url: null, ts: 0 };
    }, 31_000);
  }
});

const sendToBackground = (message) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
};

const createViewerUrl = async (demoArchiveUrl) => {
  const storageResult = await chrome.storage.sync.get({
    viewerUrl: VIEWER_DEFAULT_URL,
  });

  const base = String(storageResult.viewerUrl || VIEWER_DEFAULT_URL);
  const target = new URL(base);
  target.searchParams.set("demoArchiveUrl", demoArchiveUrl);
  return target.toString();
};

const firstBy = (elements, predicate) => {
  for (const element of elements) {
    if (predicate(element)) return element;
  }
  return null;
};

const isLikelyDemoDownloadUrl = (url) => {
  if (!url || typeof url !== "string") return false;

  try {
    const parsed = new URL(url);
    const full = `${parsed.pathname}${parsed.search}`.toLowerCase();

    if (/(\.dem(\.zst|\.gz)?)(\?|$)/i.test(full)) return true;
    if (/(\.zip|\.gz|\.zst)(\?|$)/i.test(full)) return true;
    if (parsed.hostname.includes("backblazeb2.com") && /cs2\//i.test(parsed.pathname)) return true;

    return false;
  } catch {
    return false;
  }
};

const waitForCapturedDownloadUrl = (timeoutMs = 6000) => {
  const startTs = Date.now();

  return new Promise((resolve) => {
    const tick = () => {
      const current = _lastFaceitDownload;
      if (
        current?.url &&
        isLikelyDemoDownloadUrl(current.url) &&
        current.ts >= startTs
      ) {
        resolve(current.url);
        return;
      }

      if (Date.now() - startTs >= timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(tick, 120);
    };

    tick();
  });
};

const findWatchDemoElement = () => {
  const candidates = Array.from(document.querySelectorAll("a,button"));
  return firstBy(candidates, (element) => {
    const text = (element.textContent || "").trim().toLowerCase();
    return text === "watch demo" || text.includes("watch demo");
  });
};

const collectDemoUrlCandidates = (watchDemoElement) => {
  const urls = new Set();

  const addValueIfUrl = (value) => {
    if (!value || typeof value !== "string") return;
    if (/^https?:\/\//i.test(value)) {
      urls.add(value.trim());
    }
  };

  const maybeAddElementUrl = (element) => {
    if (!element || !(element instanceof Element)) return;

    if (element instanceof HTMLAnchorElement) {
      addValueIfUrl(element.href);
    }

    const attrs = [
      "href",
      "data-href",
      "data-url",
      "data-demo-url",
      "data-link",
      "data-download-url",
    ];

    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      addValueIfUrl(value || "");
    }
  };

  maybeAddElementUrl(watchDemoElement);

  const parent = watchDemoElement?.parentElement;
  if (parent) {
    for (const sibling of Array.from(parent.querySelectorAll("a,button"))) {
      maybeAddElementUrl(sibling);
    }
  }

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.href || "";
    if (/demo|download|\.dem|\.zip|\.gz/i.test(href)) {
      addValueIfUrl(href);
    }
  }

  for (const script of Array.from(document.querySelectorAll("script"))) {
    const text = script.textContent || "";
    const matches = text.match(/https?:\/\/[^"'\s]+(?:\.dem(?:\.gz)?|\.zip|download[^"'\s]*)/gi);
    if (!matches) continue;
    for (const match of matches) {
      addValueIfUrl(match);
    }
  }

  return Array.from(urls);
};

const resolveDemoArchiveUrl = async (watchDemoElement) => {
  const candidates = collectDemoUrlCandidates(watchDemoElement);
  if (candidates.length === 0) {
    throw new Error("Could not find demo URL on this Faceit page");
  }

  const ordered = candidates.sort((a, b) => {
    const score = (value) => {
      let s = 0;
      if (/\.dem(\.gz)?$/i.test(value)) s += 5;
      if (/\.zip$/i.test(value)) s += 4;
      if (/download/i.test(value)) s += 2;
      if (/faceit/i.test(value)) s += 1;
      return s;
    };
    return score(b) - score(a);
  });

  let lastError = null;

  for (const url of ordered) {
    try {
      const result = await sendToBackground({
        type: "RESOLVE_DEMO_URL",
        url,
      });

      if (!result?.ok || !result.finalUrl) {
        throw new Error(result?.error || "Failed to resolve final URL");
      }

      if (isLikelyDemoDownloadUrl(result.finalUrl)) {
        return result.finalUrl;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error("Could not resolve a valid demo download URL from this Faceit page")
  );
};

const cloneVisualStyle = (sourceElement, targetButton) => {
  if (!(sourceElement instanceof HTMLElement)) return;

  targetButton.className = sourceElement.className;
  targetButton.style.cssText = sourceElement.style.cssText;
  targetButton.style.cursor = "pointer";
};

const insertBridgeButton = (watchDemoElement) => {
  if (!watchDemoElement || !(watchDemoElement instanceof HTMLElement)) {
    return;
  }

  if (document.getElementById(BRIDGE_BUTTON_ID)) {
    return;
  }

  const button = document.createElement("button");
  button.id = BRIDGE_BUTTON_ID;
  button.type = "button";
  button.textContent = "View 2D Demo";
  button.setAttribute("aria-label", "View demo in 2D viewer");
  cloneVisualStyle(watchDemoElement, button);

  button.addEventListener("click", async () => {
    const originalLabel = button.textContent;

    try {
      button.disabled = true;
      button.textContent = "Preparing...";

      // Prefer Faceit API-provided download_url if we've captured it recently
      const now = Date.now();
      const recent = (_lastFaceitDownload && _lastFaceitDownload.ts && (now - _lastFaceitDownload.ts) < 30_000);
      let demoArchiveUrl;

      if (recent && _lastFaceitDownload.url && isLikelyDemoDownloadUrl(_lastFaceitDownload.url)) {
        demoArchiveUrl = _lastFaceitDownload.url;
      } else {
        // Ask Faceit to generate a fresh presigned URL via native button flow,
        // then use captured payload.download_url.
        watchDemoElement.click();
        const capturedUrl = await waitForCapturedDownloadUrl(7000);

        if (capturedUrl) {
          demoArchiveUrl = capturedUrl;
        } else {
          demoArchiveUrl = await resolveDemoArchiveUrl(watchDemoElement);
        }
      }

      const viewerUrl = await createViewerUrl(demoArchiveUrl);
      window.open(viewerUrl, "_blank", "noopener,noreferrer");
      button.textContent = "Opened Viewer";
    } catch (error) {
      console.error("CS2DV Faceit Bridge: failed to open viewer", error);
      button.textContent = "Failed";
      window.alert(
        `Could not open demo in 2D viewer. ${error?.message || error}`,
      );
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = originalLabel;
      }, 1600);
    }
  });

  const parent = watchDemoElement.parentElement;
  if (parent) {
    const spacer = document.createElement("span");
    spacer.style.display = "inline-block";
    spacer.style.width = "8px";
    parent.insertBefore(spacer, watchDemoElement.nextSibling);
    parent.insertBefore(button, spacer.nextSibling);
  } else {
    watchDemoElement.insertAdjacentElement("afterend", button);
  }
};

const startFaceitButtonObserver = () => {
  const ensureButton = () => {
    const watchDemoElement = findWatchDemoElement();
    if (!watchDemoElement) return;
    insertBridgeButton(watchDemoElement);
  };

  ensureButton();

  const observer = new MutationObserver(() => {
    ensureButton();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};

const startViewerBridge = () => {
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== BRIDGE_REQUEST_SOURCE) return;

    const reply = (response) => {
      // if response contains a binary chunk that's transferable, include it in the
      // transfer list so the page receives a real ArrayBuffer / TypedArray
      const transfer = [];
      try {
        const maybeChunk = response && (response.chunk || response.response?.chunk);
        if (maybeChunk) {
          if (maybeChunk instanceof ArrayBuffer) transfer.push(maybeChunk);
          else if (ArrayBuffer.isView(maybeChunk)) transfer.push(maybeChunk.buffer);
        }
      } catch (e) {
        // ignore transfer collection errors and fall back to structured clone
      }

      window.postMessage(
        {
          source: BRIDGE_RESPONSE_SOURCE,
          replyTo: data.requestId,
          response,
        },
        "*",
        transfer.length ? transfer : undefined,
      );
    };

    try {
      if (data.messageType === "PING") {
        reply({ ok: true });
        return;
      }

      if (data.messageType === "FETCH_BEGIN") {
        const result = await sendToBackground({
          type: "PROXY_FETCH_BEGIN",
          url: data.payload?.url,
        });
        if (!result?.ok) {
          throw new Error(result?.error || "Proxy fetch begin failed");
        }

        reply({
          ok: true,
          requestId: result.requestId,
          size: result.size,
          chunkSize: result.chunkSize,
          resolvedUrl: result.resolvedUrl,
          fileName: result.fileName,
          contentType: result.contentType,
        });
        return;
      }

      if (data.messageType === "FETCH_CHUNK") {
        const result = await sendToBackground({
          type: "PROXY_FETCH_CHUNK",
          requestId: data.payload?.requestId,
          offset: data.payload?.offset,
        });

        if (!result?.ok) {
          throw new Error(result?.error || "Proxy fetch chunk failed");
        }

        reply({
          ok: true,
          chunk: result.chunkBytes || result.chunk,
          nextOffset: result.nextOffset,
          done: result.done,
        });
        return;
      }

      if (data.messageType === "FETCH_END") {
        await sendToBackground({
          type: "PROXY_FETCH_END",
          requestId: data.payload?.requestId,
        });
        reply({ ok: true });
        return;
      }

      reply({ ok: false, error: "Unsupported message type" });
    } catch (error) {
      reply({ ok: false, error: error?.message || String(error) });
    }
  });
};

if (isFaceitPage()) {
  startFaceitButtonObserver();
}

if (isViewerPage()) {
  startViewerBridge();
}

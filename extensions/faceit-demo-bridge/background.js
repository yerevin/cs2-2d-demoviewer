const CHUNK_SIZE = 512 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1000;

const archiveCache = new Map();

const cleanupArchiveCache = () => {
  const now = Date.now();
  for (const [key, value] of archiveCache.entries()) {
    if (now - value.createdAt > CACHE_TTL_MS) {
      archiveCache.delete(key);
    }
  }
};

const ensureHttpUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Unsupported URL protocol");
  }

  return parsed.toString();
};

const inferFileName = (resolvedUrl, contentDisposition) => {
  const cdMatch = contentDisposition?.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i);
  if (cdMatch?.[1]) {
    return decodeURIComponent(cdMatch[1].replace(/"/g, "").trim());
  }

  try {
    const url = new URL(resolvedUrl);
    const name = url.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "faceit-demo-archive";
  } catch {
    return "faceit-demo-archive";
  }
};

const resolveFinalDemoUrl = async (rawUrl) => {
  const url = ensureHttpUrl(rawUrl);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Range: "bytes=0-0",
      },
    });

    return response.url || url;
  } catch {
    return url;
  }
};

const fetchArchive = async (rawUrl) => {
  const url = ensureHttpUrl(rawUrl);
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const requestId = crypto.randomUUID();

  archiveCache.set(requestId, {
    bytes,
    createdAt: Date.now(),
    contentType: response.headers.get("content-type") || "",
    resolvedUrl: response.url || url,
    fileName: inferFileName(
      response.url || url,
      response.headers.get("content-disposition") || "",
    ),
  });

  cleanupArchiveCache();

  return {
    requestId,
    size: bytes.byteLength,
    chunkSize: CHUNK_SIZE,
    resolvedUrl: response.url || url,
    fileName: archiveCache.get(requestId).fileName,
    contentType: archiveCache.get(requestId).contentType,
  };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    cleanupArchiveCache();

    if (!message || typeof message.type !== "string") {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }

    if (message.type === "RESOLVE_DEMO_URL") {
      const finalUrl = await resolveFinalDemoUrl(message.url);
      sendResponse({ ok: true, finalUrl });
      return;
    }

    if (message.type === "PROXY_FETCH_BEGIN") {
      const result = await fetchArchive(message.url);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (message.type === "PROXY_FETCH_CHUNK") {
      const requestId = String(message.requestId || "");
      const offset = Number(message.offset || 0);
      const cached = archiveCache.get(requestId);

      if (!cached) {
        throw new Error("Archive request not found or expired");
      }

      const start = Math.max(0, Math.min(offset, cached.bytes.length));
      const end = Math.min(start + CHUNK_SIZE, cached.bytes.length);
      const chunk = cached.bytes.slice(start, end);

      sendResponse({
        ok: true,
        chunkBytes: Array.from(chunk),
        offset: start,
        nextOffset: end,
        done: end >= cached.bytes.length,
      });
      return;
    }

    if (message.type === "PROXY_FETCH_END") {
      const requestId = String(message.requestId || "");
      archiveCache.delete(requestId);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unsupported message type" });
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});

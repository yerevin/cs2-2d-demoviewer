interface BridgeResponse {
  ok: boolean;
  error?: string;
  [key: string]: any;
}

const BRIDGE_REQUEST_SOURCE = "CS2DV_VIEWER";
const BRIDGE_RESPONSE_SOURCE = "CS2DV_EXTENSION";

let bridgeRequestSeq = 0;

const postBridgeRequest = async (
  messageType: string,
  payload: Record<string, any>,
  timeoutMs = 120000,
): Promise<BridgeResponse> => {
  const requestId = `cs2dv-${Date.now()}-${bridgeRequestSeq++}`;

  return new Promise<BridgeResponse>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(`Extension bridge timeout (${messageType})`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;

      const data = event.data;
      if (!data || data.source !== BRIDGE_RESPONSE_SOURCE) return;
      if (data.replyTo !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);

      const response = data.response as BridgeResponse;
      if (!response) {
        reject(new Error("Invalid extension bridge response"));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error || "Extension bridge request failed"));
        return;
      }

      resolve(response);
    };

    window.addEventListener("message", onMessage);

    window.postMessage(
      {
        source: BRIDGE_REQUEST_SOURCE,
        requestId,
        messageType,
        payload,
      },
      "*",
    );
  });
};

const normalizeChunkToBytes = (chunk: any): Uint8Array => {
  if (!chunk) return new Uint8Array();

  // Raw ArrayBuffer
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }

  // TypedArray (Uint8Array, Int8Array, etc.)
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  // Plain numeric array
  if (Array.isArray(chunk)) {
    return Uint8Array.from(chunk as number[]);
  }

  // Some environments / message bridges may deliver an object like { data: [...] }
  if (chunk && typeof chunk === "object") {
    // Cross-realm ArrayBuffer can fail instanceof checks
    if (
      typeof (chunk as any).byteLength === "number" &&
      Object.prototype.toString.call(chunk) === "[object ArrayBuffer]"
    ) {
      try {
        return new Uint8Array(chunk as ArrayBuffer);
      } catch {
        // no-op
      }
    }

    if (Array.isArray(chunk.data)) {
      return Uint8Array.from(chunk.data as number[]);
    }

    // object with numeric keys (e.g. structured-cloned typed-array fallback)
    const vals = Object.values(chunk);
    if (vals.length > 0 && vals.every((v) => typeof v === "number")) {
      return Uint8Array.from(vals as number[]);
    }

    // If chunk contains a nested ArrayBuffer-like under `.buffer`
    if (chunk.buffer && chunk.buffer instanceof ArrayBuffer) {
      return new Uint8Array(chunk.buffer);
    }
  }

  // Base64 string fallback (rare) — decode if it looks like base64
  if (typeof chunk === "string" && /^[A-Za-z0-9+/=\s]+$/.test(chunk)) {
    try {
      const str = atob(chunk.trim());
      const out = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
      return out;
    } catch {
      // fall through to error
    }
  }

  const keyPreview = chunk && typeof chunk === "object" ? Object.keys(chunk).slice(0, 6) : [];
  throw new Error(`Unsupported chunk format from extension bridge (type=${typeof chunk}, keys=${keyPreview.join(",")})`);
};

export const isExtensionBridgeAvailable = async () => {
  try {
    await postBridgeRequest("PING", {}, 1500);
    return true;
  } catch {
    return false;
  }
};

export const fetchArchiveViaExtension = async (url: string) => {
  const begin = await postBridgeRequest("FETCH_BEGIN", { url });

  const requestId = begin.requestId as string;
  const totalSize = Number(begin.size || 0);
  const buffer = new Uint8Array(totalSize);

  let offset = 0;

  try {
    while (offset < totalSize) {
      const chunkResponse = await postBridgeRequest("FETCH_CHUNK", {
        requestId,
        offset,
      });

      const chunkBytes = normalizeChunkToBytes(
        chunkResponse.chunkBytes ?? chunkResponse.chunk,
      );
      if (chunkBytes.length === 0) {
        break;
      }

      buffer.set(chunkBytes, offset);
      offset += chunkBytes.length;
    }
  } finally {
    try {
      await postBridgeRequest("FETCH_END", { requestId }, 5000);
    } catch {
      // no-op
    }
  }

  if (offset !== totalSize) {
    throw new Error(
      `Incomplete archive transfer from extension (${offset}/${totalSize})`,
    );
  }

  return {
    bytes: buffer,
    resolvedUrl: (begin.resolvedUrl as string | undefined) || url,
    fileName: begin.fileName as string | undefined,
    contentType: begin.contentType as string | undefined,
  };
};

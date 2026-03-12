declare global {
  interface Window {
    Go: new () => {
      importObject: WebAssembly.Imports;
      run(instance: WebAssembly.Instance): void;
    };
    parseDemoWasm?: (demoBytes: Uint8Array) => string | { error: string };
    extractVoiceOgg?: (steamId: string, startTick: number, endTick: number) => Uint8Array | { error: string };
  }
}

export interface ProgressUpdate {
  detail: string;
  progress: number | null;
}

type ProgressCallback = (update: ProgressUpdate) => void;

let wasmReadyPromise: Promise<void> | null = null;

const reportProgress = (
  onProgress: ProgressCallback | undefined,
  detail: string,
  progress: number | null,
) => {
  onProgress?.({ detail, progress });
};

const allowPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const loadWasmExec = async () => {
  if (window.Go) return;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "parser/wasm_exec.js";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Go WASM runtime (wasm_exec.js)"));
    document.head.appendChild(script);
  });
};

const loadWasmModule = async (onProgress?: ProgressCallback) => {
  if (!wasmReadyPromise) {
    wasmReadyPromise = (async () => {
      reportProgress(onProgress, "Loading WASM runtime", 0.12);
      await loadWasmExec();

      reportProgress(onProgress, "Fetching parser module", 0.24);
      const go = new window.Go();
      const response = await fetch("parser/cs2parser.wasm");
      let instance: WebAssembly.Instance;

      reportProgress(onProgress, "Initializing parser module", 0.36);
      if (
        typeof WebAssembly.instantiateStreaming === "function" &&
        response.headers.get("content-type")?.includes("application/wasm")
      ) {
        const result = await WebAssembly.instantiateStreaming(
          response,
          go.importObject,
        );
        instance = result.instance;
      } else {
        const bytes = await response.arrayBuffer();
        const result = await WebAssembly.instantiate(bytes, go.importObject);
        instance = result.instance;
      }

      reportProgress(onProgress, "Starting parser runtime", 0.48);
      go.run(instance);

      for (let i = 0; i < 100; i++) {
        if (window.parseDemoWasm) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      throw new Error("WASM parser did not initialize");
    })();
  } else {
    reportProgress(onProgress, "Reusing parser module", 0.48);
  }

  await wasmReadyPromise;
  reportProgress(onProgress, "Reading demo bytes", 0.58);
};

export const parseDemoWithWasm = async (
  file: File,
  onProgress?: ProgressCallback,
) => {
  await loadWasmModule(onProgress);

  if (!window.parseDemoWasm) {
    throw new Error("WASM parser unavailable");
  }

  reportProgress(onProgress, "Reading demo bytes", 0.64);
  const demoBytes = new Uint8Array(await file.arrayBuffer());

  reportProgress(onProgress, "Parsing demo events", 0.78);
  await allowPaint();
  const result = window.parseDemoWasm(demoBytes);

  if (typeof result !== "string") {
    throw new Error(result.error || "Failed to parse demo");
  }

  reportProgress(onProgress, "Building match dataset", 0.94);
  await allowPaint();
  return JSON.parse(result);
};

export const extractVoiceOgg = async (
  steamId: string,
  startTick: number,
  endTick: number,
): Promise<Uint8Array> => {
  await loadWasmModule();

  if (!window.extractVoiceOgg) {
    throw new Error("Voice extraction unavailable");
  }

  const result = window.extractVoiceOgg(steamId, startTick, endTick);

  if (result instanceof Uint8Array) {
    return result;
  }

  throw new Error(
    (result as { error: string }).error || "Failed to extract voice data",
  );
};

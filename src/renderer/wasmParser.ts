declare global {
  interface Window {
    Go: new () => {
      importObject: WebAssembly.Imports;
      run(instance: WebAssembly.Instance): void;
    };
    parseDemoWasm?: (demoBytes: Uint8Array) => string | { error: string };
  }
}

let wasmReadyPromise: Promise<void> | null = null;

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

const loadWasmModule = async () => {
  if (!wasmReadyPromise) {
    wasmReadyPromise = (async () => {
      await loadWasmExec();
      const go = new window.Go();
      const response = await fetch("parser/cs2parser.wasm");
      let instance: WebAssembly.Instance;

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

      go.run(instance);

      for (let i = 0; i < 100; i++) {
        if (window.parseDemoWasm) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      throw new Error("WASM parser did not initialize");
    })();
  }

  return wasmReadyPromise;
};

export const parseDemoWithWasm = async (file: File) => {
  await loadWasmModule();

  if (!window.parseDemoWasm) {
    throw new Error("WASM parser unavailable");
  }

  const demoBytes = new Uint8Array(await file.arrayBuffer());
  const result = window.parseDemoWasm(demoBytes);

  if (typeof result !== "string") {
    throw new Error(result.error || "Failed to parse demo");
  }

  return JSON.parse(result);
};

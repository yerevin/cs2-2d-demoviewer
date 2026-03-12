import { gunzipSync, unzipSync } from "fflate";
import { parseDemoWithWasm, type ProgressUpdate } from "./wasmParser";
import { fetchArchiveViaExtensionWithProgress, isExtensionBridgeAvailable } from "./extensionBridge";

type ProgressCallback = (update: ProgressUpdate) => void;

const reportProgress = (
  onProgress: ProgressCallback | undefined,
  detail: string,
  progress: number | null,
) => {
  onProgress?.({ detail, progress });
};

const scaleProgress = (progress: number, start: number, end: number) =>
  start + (end - start) * progress;

const createChildProgress = (
  onProgress: ProgressCallback | undefined,
  start: number,
  end: number,
) => {
  return (update: ProgressUpdate) => {
    reportProgress(
      onProgress,
      update.detail,
      update.progress == null ? null : scaleProgress(update.progress, start, end),
    );
  };
};

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const getFilenameFromUrl = (url: string, fallback = "faceit-demo") => {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const fileName = pathParts[pathParts.length - 1];
    if (!fileName) return fallback;
    return decodeURIComponent(fileName);
  } catch {
    return fallback;
  }
};

const stripArchiveSuffix = (name: string) => {
  return name
    .replace(/\.(zip|rar|7z|tar|tgz|gz)$/i, "")
    .replace(/\.+$/, "")
    .trim();
};

const isZipBytes = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

const isGzipBytes = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

const isZstdBytes = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xB5 && bytes[2] === 0x2F && bytes[3] === 0xFD;

const isLikelyDemoBytes = (bytes: Uint8Array) => {
  if (bytes.length < 8) return false;
  const header = String.fromCharCode(...bytes.slice(0, 8));
  return header === "HL2DEMO";
};

const pickDemoFromZip = (zipBytes: Uint8Array, fallbackName: string) => {
  const zipEntries = unzipSync(zipBytes);
  const files = Object.entries(zipEntries).filter(([, data]) => data && data.length > 0);

  if (files.length === 0) {
    throw new Error("ZIP archive did not contain files");
  }

  const demEntries = files.filter(([entryName]) => /\.dem$/i.test(entryName));
  const [entryName, entryData] =
    demEntries.sort((a, b) => b[1].length - a[1].length)[0] ||
    files.sort((a, b) => b[1].length - a[1].length)[0];

  const normalizedName = entryName.split("/").filter(Boolean).pop() || `${fallbackName}.dem`;

  return {
    demoName: /\.dem$/i.test(normalizedName) ? normalizedName : `${normalizedName}.dem`,
    demoBytes: entryData,
  };
};

// --- zstd support (pure-JS fzstd)
let _fzstd: any = null;
const decompressZstd = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (!_fzstd) {
    // lazy-load small pure-JS implementation to keep bundle small
    _fzstd = await import(/* webpackChunkName: "fzstd" */ "fzstd");
  }

  try {
    // fzstd.decompress returns a Uint8Array
    return _fzstd.decompress(bytes);
  } catch (err) {
    throw new Error(`ZSTD decompression failed: ${err?.message || err}`);
  }
};

const extractDemoFromArchive = (archiveBytes: Uint8Array, archiveFileName: string) => {
  if (isZipBytes(archiveBytes)) {
    return pickDemoFromZip(archiveBytes, stripArchiveSuffix(archiveFileName));
  }

  if (isGzipBytes(archiveBytes)) {
    const gunzipped = gunzipSync(archiveBytes);
    const base = stripArchiveSuffix(archiveFileName) || "match";
    return {
      demoName: /\.dem$/i.test(base) ? base : `${base}.dem`,
      demoBytes: gunzipped,
    };
  }

  if (isLikelyDemoBytes(archiveBytes) || /\.dem$/i.test(archiveFileName)) {
    return {
      demoName: /\.dem$/i.test(archiveFileName) ? archiveFileName : `${archiveFileName}.dem`,
      demoBytes: archiveBytes,
    };
  }

  throw new Error("Unsupported demo archive format (expected .zip, .gz, or .dem)");
};

const fetchArchiveDirect = async (
  url: string,
  onProgress?: ProgressCallback,
) => {
  const response = await fetch(url, { method: "GET", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }

  const totalSize = Number(response.headers.get("content-length") || 0);
  let bytes: Uint8Array;

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }

      chunks.push(value);
      received += value.length;

      if (totalSize > 0) {
        reportProgress(
          onProgress,
          `Downloading archive (${Math.round((received / totalSize) * 100)}%)`,
          scaleProgress(received / totalSize, 0.08, 0.42),
        );
      } else {
        reportProgress(onProgress, "Downloading archive", null);
      }
    }

    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  } else {
    reportProgress(onProgress, "Downloading archive", null);
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  return {
    bytes,
    resolvedUrl: response.url || url,
    fileName: getFilenameFromUrl(response.url || url),
  };
};

const downloadArchive = async (
  url: string,
  onProgress?: ProgressCallback,
) => {
  try {
    return await fetchArchiveDirect(url, onProgress);
  } catch (directError) {
    const bridgeAvailable = await isExtensionBridgeAvailable();
    if (!bridgeAvailable) {
      throw directError;
    }

    reportProgress(onProgress, "Downloading archive via extension bridge", null);
    return fetchArchiveViaExtensionWithProgress(url, (received, total) => {
      if (total > 0) {
        reportProgress(
          onProgress,
          `Downloading archive (${Math.round((received / total) * 100)}%)`,
          scaleProgress(received / total, 0.08, 0.42),
        );
        return;
      }

      reportProgress(onProgress, "Downloading archive via extension bridge", null);
    });
  }
};

export const loadDemoFromArchiveUrl = async (
  archiveUrl: string,
  onProgress?: ProgressCallback,
) => {
  if (!isHttpUrl(archiveUrl)) {
    throw new Error("Invalid archive URL");
  }

  reportProgress(onProgress, "Starting remote demo download", 0.04);
  const archive = await downloadArchive(archiveUrl, onProgress);
  let archiveBytes = archive.bytes;
  let archiveFileName = archive.fileName || getFilenameFromUrl(archive.resolvedUrl || archiveUrl);

  // support .zst (Zstandard compressed payloads)
  if (isZstdBytes(archiveBytes) || /\.zst$/i.test(archiveFileName)) {
    try {
      reportProgress(onProgress, "Decompressing .zst archive", 0.54);
      const decompressed = await decompressZstd(archiveBytes);
      // @ts-ignore - trust fzstd's return type, which is a Uint8Array
      archiveBytes = decompressed;
      archiveFileName = archiveFileName.replace(/\.zst$/i, "");
    } catch (err: any) {
      throw new Error(`Failed to decompress .zst archive: ${err?.message || err}`);
    }
  }

  reportProgress(onProgress, "Extracting demo from archive", 0.62);
  const { demoBytes, demoName } = extractDemoFromArchive(archiveBytes, archiveFileName);
  // @ts-ignore - trust fzstd's return type, which is a Uint8Array
  const file = new File([demoBytes], demoName, { type: "application/octet-stream" });

  reportProgress(onProgress, "Preparing demo parser", 0.66);
  const parsed = await parseDemoWithWasm(file, createChildProgress(onProgress, 0.68, 0.97));
  reportProgress(onProgress, "Finalizing imported demo", 0.99);

  return {
    parsed,
    fileName: demoName,
    sourceUrl: archive.resolvedUrl || archiveUrl,
  };
};

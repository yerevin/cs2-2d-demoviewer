import { gunzipSync, unzipSync } from "fflate";
import { parseDemoWithWasm } from "./wasmParser";
import { fetchArchiveViaExtension, isExtensionBridgeAvailable } from "./extensionBridge";

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

const fetchArchiveDirect = async (url: string) => {
  const response = await fetch(url, { method: "GET", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    resolvedUrl: response.url || url,
    fileName: getFilenameFromUrl(response.url || url),
  };
};

const downloadArchive = async (url: string) => {
  try {
    return await fetchArchiveDirect(url);
  } catch (directError) {
    const bridgeAvailable = await isExtensionBridgeAvailable();
    if (!bridgeAvailable) {
      throw directError;
    }

    return fetchArchiveViaExtension(url);
  }
};

export const loadDemoFromArchiveUrl = async (archiveUrl: string) => {
  if (!isHttpUrl(archiveUrl)) {
    throw new Error("Invalid archive URL");
  }

  const archive = await downloadArchive(archiveUrl);
  let archiveBytes = archive.bytes;
  let archiveFileName = archive.fileName || getFilenameFromUrl(archive.resolvedUrl || archiveUrl);

  // support .zst (Zstandard compressed payloads)
  if (isZstdBytes(archiveBytes) || /\.zst$/i.test(archiveFileName)) {
    try {
      const decompressed = await decompressZstd(archiveBytes);
      // @ts-ignore - trust fzstd's return type, which is a Uint8Array
      archiveBytes = decompressed;
      archiveFileName = archiveFileName.replace(/\.zst$/i, "");
    } catch (err: any) {
      throw new Error(`Failed to decompress .zst archive: ${err?.message || err}`);
    }
  }

  const { demoBytes, demoName } = extractDemoFromArchive(archiveBytes, archiveFileName);
      // @ts-ignore - trust fzstd's return type, which is a Uint8Array
  const file = new File([demoBytes], demoName, { type: "application/octet-stream" });

  const parsed = await parseDemoWithWasm(file);

  return {
    parsed,
    fileName: demoName,
    sourceUrl: archive.resolvedUrl || archiveUrl,
  };
};

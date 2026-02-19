(() => {
  if (window.__cs2dv_faceit_hook_installed) return;
  window.__cs2dv_faceit_hook_installed = true;

  const TARGET_PATH = "/api/download/v2/demos/download-url";
  const SOURCE = "CS2DV_FACEIT_HOOK";

  const postDownloadUrl = (downloadUrl) => {
    if (!downloadUrl || typeof downloadUrl !== "string") return;
    window.postMessage({ source: SOURCE, download_url: downloadUrl }, "*");
  };

  const extractAndPost = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const downloadUrl = payload?.payload?.download_url;
    postDownloadUrl(downloadUrl);
  };

  try {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const requestLike = args[0];
      const url =
        typeof requestLike === "string"
          ? requestLike
          : requestLike?.url || "";

      const promise = originalFetch.apply(this, args);

      if (String(url).includes(TARGET_PATH)) {
        promise
          .then((response) => {
            try {
              response
                .clone()
                .json()
                .then((json) => extractAndPost(json))
                .catch(() => {});
            } catch {
              // no-op
            }
          })
          .catch(() => {});
      }

      return promise;
    };
  } catch {
    // no-op
  }

  try {
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (...args) {
      this.__cs2dv_url = args[1] || "";
      return originalXhrOpen.apply(this, args);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      try {
        if (String(this.__cs2dv_url || "").includes(TARGET_PATH)) {
          this.addEventListener("load", function () {
            try {
              const text = this.responseText || "";
              const parsed = JSON.parse(text || "{}");
              extractAndPost(parsed);
            } catch {
              // no-op
            }
          });
        }
      } catch {
        // no-op
      }

      return originalXhrSend.apply(this, args);
    };
  } catch {
    // no-op
  }
})();

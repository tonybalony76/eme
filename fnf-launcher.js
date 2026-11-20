(() => {
  "use strict";
  const REPO = "tonybalony76/eme";
  const CDN_ROOT = "https://cdn.jsdelivr.net/gh/" + REPO;
  const SHARD_REFS = {"cdn-01":"62b36e5f6e485e73dab60425d2bb0b860e4c1658","cdn-02":"1158c8fe5544d74f45c817273e0c566965feb1a8","cdn-03":"d34f7be8a755127b32132823789c8cf591c9558f","cdn-04":"321d15dcebd6ae98792957d8855f5cdb02976786","cdn-05":"1da411737a01b5cfd74cc6231908ba27e98dc47e","cdn-06":"fb7b79bf1442c9ef0d0a0c8a4aa7f9c8d054c570","cdn-07":"95063c7ca1cc62e95b6e4d8d4ebe5f7814e9033f","cdn-08":"c741de351b5cdf6a06cc6a7317e929d8a9887f39","cdn-09":"a72d1145f0dbb791da095d8b03455161326da676","cdn-10":"49bbc96f069dbbfb560fa7d91821aed5d52b337b","cdn-11":"996c5c21af49c53e79b05599ccb79015836cc81d","cdn-12":"53515bfc16e990bb597b1b0a40c7124d987bffba","cdn-13":"5da6e66c36e86b46a86dae32518b442d51813cf8","cdn-14":"dc94a4310714751dec456311d5d91d1b6f397de5","cdn-15":"867426aeac4a45b26c1e1e85ddd04d82208bd11b","cdn-16":"5d46741fd18c2309ef643667b28a0297b641de30","cdn-17":"70176fb464d49e9d71dee9af56850b40c84f91ea","cdn-18":"1f42f3cd858d5155ac7c9f6fc1b07aeee3e1f9fb","cdn-19":"968ac27fdc63e9f796f7dc84941905313334c425","cdn-20":"a28efcee9838bdca23c118094f49fc6a14739fbd","cdn-21":"3fb5dcb2e044f58c4e2bc60ac7957f3ad26d576f","cdn-22":"ba6bbcaec50cd24e15ea488006f21a8f29cf4fe1"};
  const MANIFEST_URL = CDN_ROOT + "@62b36e5f6e485e73dab60425d2bb0b860e4c1658/cdn/manifest.json";
  function chunkUrl(chunk) {
    const ref = SHARD_REFS[chunk.shard];
    if (!ref) throw new Error("Unknown FNF CDN shard: " + chunk.shard);
    return CDN_ROOT + "@" + ref + "/cdn/chunks/" + chunk.name;
  }
  const FAKE_ORIGIN = "https://fnf.invalid/";

  async function readManifest() {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the FNF file manifest (" + response.status + ").");
    return response.json();
  }

  function makeFileReader(manifest) {
    const entries = new Map(manifest.files.map(file => [file.path.replace(/^\.?\//, ""), file]));
    const pending = new Map();
    const urls = new Map();

    async function getBytes(file) {
      const parts = await Promise.all(file.chunks.map(async chunk => {
        const url = chunkUrl(chunk);
        const response = await fetch(url);
        if (!response.ok) throw new Error("Could not download " + chunk.name + " (" + response.status + ").");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength !== chunk.bytes) throw new Error("Unexpected chunk size: " + chunk.name);
        return bytes;
      }));
      const result = new Uint8Array(file.bytes);
      let offset = 0;
      for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
      if (offset !== file.bytes) throw new Error("Unexpected reconstructed size: " + file.path);
      return result;
    }

    async function blobForPath(path) {
      path = String(path || "").replace(/^\/+/, "").replace(/^\.\//, "");
      const file = entries.get(path);
      if (!file) throw new Error("FNF asset not found in manifest: " + path);
      if (urls.has(path)) return { url: urls.get(path), file };
      if (!pending.has(path)) {
        pending.set(path, (async () => {
          const bytes = await getBytes(file);
          const blob = new Blob([bytes], { type: file.mime || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          urls.set(path, url);
          return { url, file };
        })().finally(() => pending.delete(path)));
      }
      return pending.get(path);
    }
    return { blobForPath };
  }

  function bridge(manifest, CDN_ROOT) {
    "use strict";
    const entries = new Map(manifest.files.map(file => [file.path.replace(/^\.?\//, ""), file]));
    const pending = new Map();
    const objectUrls = new Map();

    function pathFrom(value) {
      try {
        const url = new URL(typeof value === "string" ? value : value.url, document.baseURI);
        if (url.hostname !== "fnf.invalid") return null;
        return decodeURIComponent(url.pathname).replace(/^\/+/, "");
      } catch (_) { return null; }
    }

    async function getBlob(path) {
      path = String(path || "").replace(/^\/+/, "").replace(/^\.\//, "");
      if (objectUrls.has(path)) return objectUrls.get(path);
      if (!entries.has(path)) throw new Error("Missing FNF asset: " + path);
      if (!pending.has(path)) {
        pending.set(path, (async () => {
          const file = entries.get(path);
          const chunks = await Promise.all(file.chunks.map(async chunk => {
            const url = CDN_ROOT + "@" + chunk.shard + "/cdn/chunks/" + chunk.name;
            const response = await window.__fnfNativeFetch(url);
            if (!response.ok) throw new Error("Chunk request failed: " + chunk.name + " (" + response.status + ")");
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength !== chunk.bytes) throw new Error("Bad chunk size: " + chunk.name);
            return bytes;
          }));
          const bytes = new Uint8Array(file.bytes);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          if (offset !== file.bytes) throw new Error("Bad reconstructed size: " + path);
          const blob = new Blob([bytes], { type: file.mime || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          objectUrls.set(path, url);
          return url;
        })().finally(() => pending.delete(path)));
      }
      return pending.get(path);
    }

    const nativeFetch = window.fetch.bind(window);
    window.__fnfNativeFetch = nativeFetch;
    window.fetch = async function(input, init) {
      const path = pathFrom(input);
      if (path === null) return nativeFetch(input, init);
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") return nativeFetch(input, init);
      try {
        const url = await getBlob(path);
        const blob = await nativeFetch(url).then(r => r.blob());
        const file = entries.get(path);
        return new Response(method === "HEAD" ? null : blob, {
          status: 200,
          headers: { "Content-Type": file.mime || "application/octet-stream", "Content-Length": String(file.bytes) }
        });
      } catch (error) {
        return new Response(String(error), { status: 404, headers: { "Content-Type": "text/plain" } });
      }
    };

    const XHR = window.XMLHttpRequest;
    const xOpen = XHR.prototype.open;
    const xSend = XHR.prototype.send;
    const xHeader = XHR.prototype.setRequestHeader;
    const xMime = XHR.prototype.overrideMimeType;
    const dummyUrl = URL.createObjectURL(new Blob([]));
    XHR.prototype.open = function(method, url, async, user, password) {
      const path = pathFrom(url);
      if (path === null) {
        this.__fnfRequest = null;
        return xOpen.call(this, method, url, async, user, password);
      }
      this.__fnfRequest = { method, path, async: async !== false, user, password, headers: [], mime: null };
      return xOpen.call(this, method, dummyUrl, async, user, password);
    };
    XHR.prototype.setRequestHeader = function(name, value) {
      if (this.__fnfRequest) { this.__fnfRequest.headers.push([name, value]); return; }
      return xHeader.call(this, name, value);
    };
    XHR.prototype.overrideMimeType = function(value) {
      if (this.__fnfRequest) { this.__fnfRequest.mime = value; return; }
      return xMime.call(this, value);
    };
    XHR.prototype.send = function(body) {
      const request = this.__fnfRequest;
      if (!request) return xSend.call(this, body);
      if (!request.async) { console.error("Synchronous FNF asset requests are unsupported:", request.path); return; }
      const xhr = this;
      const responseType = xhr.responseType;
      const timeout = xhr.timeout;
      const withCredentials = xhr.withCredentials;
      getBlob(request.path).then(url => {
        xOpen.call(xhr, request.method, url, true, request.user, request.password);
        try { xhr.responseType = responseType; } catch (_) {}
        try { xhr.timeout = timeout; } catch (_) {}
        try { xhr.withCredentials = withCredentials; } catch (_) {}
        for (const pair of request.headers) { try { xHeader.call(xhr, pair[0], pair[1]); } catch (_) {} }
        if (request.mime) { try { xMime.call(xhr, request.mime); } catch (_) {} }
        xSend.call(xhr, body);
      }).catch(error => {
        console.error(error);
        try { xhr.dispatchEvent(new ProgressEvent("error")); } catch (_) {}
        try { xhr.dispatchEvent(new ProgressEvent("loadend")); } catch (_) {}
      });
    };

    function patchSrc(proto) {
      if (!proto) return;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "src");
      if (!descriptor || !descriptor.set || !descriptor.get) return;
      Object.defineProperty(proto, "src", {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: function() { return descriptor.get.call(this); },
        set: function(value) {
          const path = pathFrom(value);
          if (path === null) return descriptor.set.call(this, value);
          getBlob(path).then(url => descriptor.set.call(this, url)).catch(error => {
            console.error(error);
            this.dispatchEvent(new Event("error"));
          });
        }
      });
    }
    patchSrc(window.HTMLImageElement && HTMLImageElement.prototype);
    patchSrc(window.HTMLMediaElement && HTMLMediaElement.prototype);
    patchSrc(window.HTMLSourceElement && HTMLSourceElement.prototype);
    console.info("FNF virtual asset loader ready:", manifest.fileCount, "files");
  }

  async function launch() {
    const gameWindow = window.open("about:blank", "_blank");
    if (!gameWindow) {
      alert("Your browser blocked the new tab. Allow pop-ups for this Google Sites page and try again.");
      return;
    }

    function showMessage(message, isError) {
      try {
        gameWindow.document.open();
        gameWindow.document.write(
          "<!doctype html><html><head><title>Friday Night Funkin'</title>" +
          "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
          "<style>html,body{margin:0;width:100%;height:100%;background:#111;color:#fff;font:16px Arial;display:grid;place-items:center}main{max-width:640px;padding:28px;text-align:center}p{line-height:1.5;color:#ddd}</style></head>" +
          "<body><main><h2>" + (isError ? "FNF couldn't start" : "Loading Friday Night Funkin'...") +
          "</h2><p>" + String(message).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])) +
          "</p></main></body></html>"
        );
        gameWindow.document.close();
      } catch (_) {}
    }

    showMessage("Preparing the game files. Large assets are downloaded only when the game requests them.", false);
    try {
      const manifest = await readManifest();
      const reader = makeFileReader(manifest);
      const indexFile = await reader.blobForPath("index.html");
      const indexText = await (await fetch(indexFile.url)).text();
      const jsFile = await reader.blobForPath("Funkin.js");

      const parsed = new DOMParser().parseFromString(indexText, "text/html");
      parsed.title = "Friday Night Funkin'";
      let base = parsed.querySelector("base");
      if (!base) { base = parsed.createElement("base"); parsed.head.prepend(base); }
      base.href = FAKE_ORIGIN;

      const fontUrls = [];
      for (const style of parsed.querySelectorAll("style")) {
        const matches = [...style.textContent.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)];
        for (const match of matches) {
          const raw = match[1].trim();
          if (/^(data:|blob:|https?:)/i.test(raw)) continue;
          const path = new URL(raw.split("#")[0].split("?")[0], FAKE_ORIGIN).pathname.replace(/^\/+/, "");
          if (path && !fontUrls.includes(path)) fontUrls.push(path);
        }
      }

      const fontMap = new Map();
      await Promise.all(fontUrls.map(async path => {
        try { fontMap.set(path, (await reader.blobForPath(path)).url); }
        catch (error) { console.warn("Optional font unavailable:", path, error); }
      }));

      for (const style of parsed.querySelectorAll("style")) {
        style.textContent = style.textContent.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (whole, raw) => {
          if (/^(data:|blob:|https?:)/i.test(raw.trim())) return whole;
          const path = new URL(raw.trim().split("#")[0].split("?")[0], FAKE_ORIGIN).pathname.replace(/^\/+/, "");
          return fontMap.has(path) ? "url('" + fontMap.get(path) + "')" : whole;
        });
      }

      for (const link of parsed.querySelectorAll('link[rel~="icon"]')) {
        try { link.href = (await reader.blobForPath("favicon.png")).url; }
        catch (_) { link.remove(); }
      }

      const gameScript = parsed.querySelector('script[src*="Funkin.js"]');
      if (!gameScript) throw new Error("The original index.html did not contain the expected Funkin.js script.");
      gameScript.src = jsFile.url;

      const bridgeSource = "(" + bridge.toString() + ")(" + JSON.stringify(manifest) + "," + JSON.stringify(CDN_ROOT) + ");";
      const bridgeBlob = new Blob([bridgeSource], { type: "text/javascript" });
      const bridgeScript = parsed.createElement("script");
      bridgeScript.src = URL.createObjectURL(bridgeBlob);
      gameScript.parentNode.insertBefore(bridgeScript, gameScript);

      gameWindow.document.open();
      gameWindow.document.write("<!doctype html>\n" + parsed.documentElement.outerHTML);
      gameWindow.document.close();
    } catch (error) {
      showMessage(error && error.message ? error.message : String(error), true);
      console.error("FNF launch failed:", error);
    }
  }

  window.FNFOriginalLauncher = { open: launch };
})();
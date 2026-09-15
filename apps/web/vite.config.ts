import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function offlineShellPlugin(): Plugin {
  return {
    name: "ai-notebook-offline-shell",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((fileName) => !fileName.endsWith(".map")).sort();
      const buildFingerprint = createHash("sha256");
      for (const fileName of files) {
        const output = bundle[fileName];
        buildFingerprint.update(fileName);
        buildFingerprint.update(output.type === "chunk" ? output.code : output.source);
      }
      const version = buildFingerprint.digest("hex").slice(0, 12);
      const precacheUrls = ["./", ...files.map((fileName) => `./${fileName}`)];
      const source = `const CACHE_PREFIX = "ai-notebook-shell-";
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === "navigate") {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(new URL("./", self.registration.scope), response.clone());
        return response;
      } catch {
        return (await cache.match(new URL("./", self.registration.scope))) || Response.error();
      }
    }

    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), offlineShellPlugin()],
  server: {
    host: true,
  },
});

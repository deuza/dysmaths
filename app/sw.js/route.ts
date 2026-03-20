import fs from "node:fs";
import path from "node:path";

function getBuildId() {
  try {
    return fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "dev";
  }
}

export function GET() {
  const buildId = getBuildId();
  const script = `
const BUILD_ID = ${JSON.stringify(buildId)};
const STATIC_CACHE = "dysmaths-static-" + BUILD_ID;
const RUNTIME_CACHE = "dysmaths-runtime-" + BUILD_ID;
const PRECACHE_URLS = ["/", "/en", "/fr", "/es", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isCacheableAsset(requestUrl) {
  return requestUrl.pathname.startsWith("/_next/static/") ||
    requestUrl.pathname.startsWith("/mathlive/") ||
    requestUrl.pathname === "/icon.svg";
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    const url = new URL(request.url);
    const localeMatch = url.pathname.match(/^\\/(en|fr|es)(?:\\/|$)/);
    const localePath = localeMatch ? "/" + localeMatch[1] : "/en";
    return (await caches.match(localePath)) || (await caches.match("/en")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const {request} = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
`.trim();

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate"
    }
  });
}

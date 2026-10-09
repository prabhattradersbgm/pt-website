const CACHE_NAME = 'prabhat-traders-v1';
const MAX_CACHE_ENTRIES = 120;
const MAX_AGE = {
  document: 24 * 60 * 60 * 1000,
  asset: 24 * 60 * 60 * 1000,
  image: 30 * 24 * 60 * 60 * 1000,
};
const MAX_OFFLINE_AGE = {
  document: 7 * 24 * 60 * 60 * 1000,
  asset: 7 * 24 * 60 * 60 * 1000,
  image: 90 * 24 * 60 * 60 * 1000,
};
const CACHED_AT_HEADER = 'X-Prabhat-Cached-At';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('prabhat-traders-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);

  if (
    request.method !== 'GET'
    || requestUrl.origin !== scopeUrl.origin
    || !requestUrl.pathname.startsWith(scopeUrl.pathname)
  ) {
    return;
  }

  const resourceType = getResourceType(request);
  if (!resourceType) return;

  event.respondWith(serveWithCache(request, resourceType));
});

function getResourceType(request) {
  if (request.mode === 'navigate') return 'document';
  if (request.destination === 'image') return 'image';
  if (['script', 'style', 'font'].includes(request.destination)) return 'asset';
  return null;
}

async function serveWithCache(request, resourceType) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  const cachedAt = cachedResponse
    ? Number(cachedResponse.headers.get(CACHED_AT_HEADER)) || 0
    : 0;
  const age = Date.now() - cachedAt;

  if (cachedResponse && age < MAX_AGE[resourceType]) {
    return removeCacheMetadata(cachedResponse);
  }

  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    if (cachedResponse && age < MAX_OFFLINE_AGE[resourceType]) {
      return removeCacheMetadata(cachedResponse);
    }
    throw error;
  }

  if (response.ok && response.type === 'basic') {
    try {
      await storeResponse(cache, request, response);
    } catch (error) {
      console.error('Failed to store a response in the service worker cache:', request.url, error);
    }
  }
  return response;
}

async function storeResponse(cache, request, response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  const cachedCopy = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  await cache.put(request, cachedCopy);
  const entries = await cache.keys();
  if (entries.length > MAX_CACHE_ENTRIES) {
    await Promise.all(entries.slice(0, entries.length - MAX_CACHE_ENTRIES).map((entry) => cache.delete(entry)));
  }
}

function removeCacheMetadata(response) {
  const headers = new Headers(response.headers);
  headers.delete(CACHED_AT_HEADER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const CACHE_PREFIX = 'clipjs-pwa';
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);
const APP_SHELL = [
  '/',
  '/projects',
  '/about',
];
const STATIC_SHELL = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)),
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_SHELL)),
    ]),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(`${CACHE_PREFIX}-`) && !ACTIVE_CACHES.has(name))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

const networkFirstNavigation = async (request) => {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (
      (await cache.match(request, {ignoreSearch: true}))
      || (await cache.match('/projects'))
      || (await cache.match('/'))
    );
  }
};

const refreshStaticAsset = async (request) => {
  const response = await fetch(request);
  if (response.status === 200 && response.type === 'basic') {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const {request} = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const isStaticAsset = url.pathname === '/manifest.webmanifest' || [
    '/_next/static/',
    '/icons/',
    '/landing/',
  ].some((prefix) => url.pathname.startsWith(prefix));

  if (!isStaticAsset) {
    return;
  }

  const refresh = refreshStaticAsset(request);
  event.waitUntil(refresh.then(() => undefined, () => undefined));
  event.respondWith(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.match(request))
      .then((cached) => cached || refresh),
  );
});

/* Service worker for the instructor schedule.
 *
 * Instructors often have no reception where they ride, so the page must open
 * from the device rather than the network. Three jobs:
 *
 *   1. Cache the page shell, so tapping the link always opens something.
 *   2. Cache the schedule data (a week at a time) and serve it when offline,
 *      with the page showing how old it is.
 *   3. Wake on a push when the office changes a ride, re-fetch in the
 *      background and replace the cached copy — so the next time the phone is
 *      opened it is already current, signal or not.
 */
const VERSION = 'svsh-v1';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const SHELL_FILES = ['/schedule', '/schedule.html', '/style.css', '/schedule.js'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

const isSchedule = (url) => url.pathname === '/api/public/schedule';

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

    // Schedule data: network first (it must be fresh when it can be), falling
    // back to the last good copy. A cached response is tagged with the time it
    // was stored so the page can say "showing 06:41".
    if (isSchedule(url)) {
        e.respondWith((async () => {
            const cache = await caches.open(DATA);
            try {
                const res = await fetch(e.request);
                if (res.ok) await cache.put(e.request, await stamp(res.clone()));
                return res;
            } catch (err) {
                const hit = await cache.match(e.request);
                if (hit) return hit;
                return new Response(JSON.stringify({ error: 'offline', offline: true }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } });
            }
        })());
        return;
    }

    // Shell: network first with a short timeout, cache as the fallback.
    //
    // Cache-first would open marginally faster, but style.css is shared with
    // the office app and this worker's scope is the whole site — serving a
    // stale stylesheet there after a deploy is a worse bug than a 3s wait.
    // When there is genuinely no signal, fetch rejects at once and the cache
    // answers immediately, which is the case that matters.
    if (SHELL_FILES.includes(url.pathname)) {
        e.respondWith((async () => {
            const cache = await caches.open(SHELL);
            try {
                const res = await withTimeout(fetch(e.request), 3000);
                if (res.ok) cache.put(url.pathname, res.clone());
                return res;
            } catch (err) {
                const hit = await cache.match(url.pathname);
                if (hit) return hit;
                throw err;
            }
        })());
    }
});

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), ms))
    ]);
}

// Record when a response was cached, so the page can show its age offline
async function stamp(res) {
    const body = await res.blob();
    const headers = new Headers(res.headers);
    headers.set('X-Cached-At', new Date().toISOString());
    return new Response(body, { status: res.status, headers });
}

/* A schedule change pushes here. Re-fetch the week the instructor last looked
 * at and overwrite the cache, so opening the app later shows the new version
 * even with no signal at that moment. iOS additionally requires that every
 * push shows a notification, which doubles as the "schedule changed" nudge
 * that used to be sent by hand on WhatsApp. */
self.addEventListener('push', (e) => {
    let data = {};
    try { data = e.data ? e.data.json() : {}; } catch (err) { /* keep defaults */ }
    e.waitUntil((async () => {
        await refreshCachedSchedules();
        const clientsList = await self.clients.matchAll({ type: 'window' });
        clientsList.forEach((c) => c.postMessage({ type: 'schedule-changed', date: data.date }));
        await self.registration.showNotification('Schedule updated', {
            body: data.body || 'The riding schedule has changed. Open to see the latest.',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'svsh-schedule',      // collapse repeats instead of stacking
            renotify: true,
            data: { url: data.url || '/schedule' }
        });
    })());
});

// Re-fetch every schedule range already in the cache
async function refreshCachedSchedules() {
    const cache = await caches.open(DATA);
    const reqs = await cache.keys();
    await Promise.all(reqs.map(async (req) => {
        try {
            const res = await fetch(req, { cache: 'no-store' });
            if (res.ok) await cache.put(req, await stamp(res.clone()));
        } catch (err) { /* still offline — the queued push will come again */ }
    }));
}

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const url = (e.notification.data && e.notification.data.url) || '/schedule';
    e.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const open = all.find((c) => c.url.includes('/schedule'));
        if (open) { open.focus(); open.postMessage({ type: 'schedule-changed' }); return; }
        await self.clients.openWindow(url);
    })());
});

// The page asks for a refresh when it comes back to the foreground
self.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'refresh') e.waitUntil(refreshCachedSchedules());
});
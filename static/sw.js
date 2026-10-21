// Thieves Den service worker. It exists so Android can install the Archive and list it in the
// share sheet. It caches nothing: everything in the Den is private and always comes fresh from
// the server. When the phone is offline, page loads get a short note instead of an error.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · Thieves Den</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#fff;font:600 18px/1.4 system-ui,sans-serif;text-align:center;padding:24px">
<div><p style="font:400 44px/1 Impact,sans-serif;letter-spacing:.04em;margin:0 0 12px;transform:rotate(-3deg)">NO SIGNAL</p>
<p>The Den needs a connection. Try again when you're back online.</p>
<p><a href="/" style="color:#3fd8ff">Retry</a></p></div></body>`;

self.addEventListener('fetch', (event) => {
	const request = event.request;
	// Only page loads; shares (POST), files and data go straight to the network untouched.
	if (request.method !== 'GET' || request.mode !== 'navigate') return;
	event.respondWith(
		fetch(request).catch(
			() =>
				new Response(OFFLINE, {
					status: 503,
					headers: { 'content-type': 'text/html; charset=utf-8' }
				})
		)
	);
});

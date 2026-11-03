/* Service worker: deixa o app abrir sem internet. Troque VERSAO ao publicar mudanças. */
const VERSAO = 'glicemia-v7';
const ARQUIVOS = [
  './', 'index.html', 'privacidade.html', 'termos.html', 'style.css', 'config.js', 'vendor/supabase.js', 'logic.js', 'painel.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Responde do cache e atualiza em segundo plano; abre mesmo sem rede. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSAO).then(async (c) => {
      const guardado = await c.match(e.request, { ignoreSearch: true });
      const rede = fetch(e.request)
        .then((res) => { if (res && res.ok) c.put(e.request, res.clone()); return res; })
        .catch(() => guardado || new Response('Sem conexão e sem cópia guardada.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
      return guardado || rede;
    })
  );
});

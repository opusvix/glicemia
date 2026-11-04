/* Service worker: deixa o app abrir sem internet. Troque VERSAO ao publicar mudanças. */
const VERSAO = 'glicemia-v11';
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

/* Rede primeiro, cópia guardada só se a rede falhar ou demorar. Assim o app nunca mistura arquivos novos com antigos
   depois de uma atualização, e continua abrindo sem internet. "no-cache" faz o navegador conferir com o servidor
   em vez de reaproveitar uma cópia antiga do cache HTTP (o GitHub Pages guarda cada arquivo por até 10 minutos). */
const ESPERA_REDE_MS = 4000;

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSAO).then(async (c) => {
      const rede = fetch(e.request, { cache: 'no-cache' }).then((res) => {
        if (res && res.ok) c.put(e.request, res.clone());
        return res;
      });
      const limite = new Promise((_, falha) => setTimeout(() => falha(new Error('demorou')), ESPERA_REDE_MS));
      try {
        return await Promise.race([rede, limite]);
      } catch (erro) {
        const guardado = await c.match(e.request, { ignoreSearch: true });
        if (guardado) return guardado;
        rede.catch(() => {});
        return new Response('Sem conexão e sem cópia guardada.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })
  );
});

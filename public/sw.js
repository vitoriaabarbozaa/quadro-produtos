// Service worker do Quadro de Produtos.
// - Habilita a instalação como app (PWA) e abre a "casca" do app mesmo sem internet.
// - A programação em si vem do Firebase em tempo real e NÃO passa por aqui
//   (só tratamos requisições GET do mesmo domínio), então os dados nunca ficam velhos.
// Para forçar todo mundo a baixar tudo de novo, mude o número da VERSION.
const VERSION = "v1";
const CACHE = `quadro-produtos-${VERSION}`;
const BASE = self.registration.scope; // ex.: https://site.vercel.app/ ou .../quadro-prodrutos/

const SHELL = [
  BASE,
  BASE + "manifest.webmanifest",
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google Fonts etc. vão direto pra rede

  // Páginas: tenta a rede primeiro (pega sempre a versão nova); sem internet, usa a salva.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(BASE, copy));
          return res;
        })
        .catch(() => caches.match(BASE).then(hit => hit || Response.error())),
    );
    return;
  }

  // Arquivos do app (JS/CSS com hash, ícones): usa o salvo e atualiza em segundo plano.
  event.respondWith(
    caches.match(req).then(hit => {
      const network = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});

/*
 * Service worker: кэширует ТОЛЬКО оболочку приложения.
 *
 * calendar.json сюда намеренно не попадает. Если бы данные шли через обычный
 * обработчик воркера, тот сохранил бы сетевой ответ в Cache Storage раньше,
 * чем приложение успело его проверить, — и повреждённый JSON осел бы в кэше
 * как рабочий. Тогда вся защита last-known-good стала бы декоративной.
 * Данными распоряжается только приложение, см. store.js.
 *
 * APP_CACHE_VERSION меняется при правке ЛЮБОГО ресурса из PRECACHE, а также
 * самого этого файла. Версия данных живёт отдельно, в поле dataHash.
 */

const APP_CACHE_VERSION = "v1";
const CACHE_NAME = `calendar-shell-${APP_CACHE_VERSION}`;

// Пути относительные: сайт живёт в подкаталоге, абсолютные увели бы в корень
// домена и всё сломали.
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./fonts.css",
  "./app.js",
  "./dates.js",
  "./moon.js",
  "./store.js",
  "./validate.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

const DATA_PATH = "/data/calendar.json";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Чистим только свои прошлые версии оболочки. Хранилище данных
      // принадлежит приложению и здесь не трогается ни при каких условиях:
      // сорвавшееся обновление оболочки не должно утащить за собой данные.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("calendar-shell-") && n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Данные — мимо воркера, целиком под управлением приложения.
  if (url.pathname.endsWith(DATA_PATH)) return;

  // Чужие домены не кэшируем.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // Навигационный запрос без сети — отдаём оболочку из кэша,
        // дальше приложение само решит, что показать.
        if (request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        throw new Error("ресурс недоступен офлайн");
      }
    })(),
  );
});

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

const APP_CACHE_VERSION = "v3";

// Тот же вывод идентификатора, что в client-id.js. Дублируется намеренно:
// sw.js — классический воркер, ESM-импорт здесь недоступен без
// type: "module" при регистрации, а его не держат старые iOS.
function clientIdFrom(href) {
  const path = new URL("./", href).pathname;
  const segment = path.split("/").filter(Boolean).pop();
  return segment || "local";
}

const CLIENT_ID = clientIdFrom(self.location.href);
const CACHE_PREFIX = `calendar-${CLIENT_ID}-shell-`;
const CACHE_NAME = CACHE_PREFIX + APP_CACHE_VERSION;

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
  "./client-id.js",
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
          // Только СВОИ прошлые версии. Общий префикс calendar-shell- снёс бы
          // офлайн-оболочку остальных клиентов: кэши общие на весь origin.
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
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
      // Ищем в СВОЁМ кэше, а не по всем сразу: caches.match() без имени
      // обходит хранилище всего origin и мог бы отдать файл другого клиента.
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // Навигационный запрос без сети — отдаём оболочку из кэша,
        // дальше приложение само решит, что показать.
        if (request.mode === "navigate") {
          const shell = await cache.match("./index.html");
          if (shell) return shell;
        }
        throw new Error("ресурс недоступен офлайн");
      }
    })(),
  );
});

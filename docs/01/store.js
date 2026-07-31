/**
 * Хранилище календарных данных — и единственный их владелец.
 *
 * Service worker к calendar.json не прикасается намеренно. Попади файл под
 * обычный обработчик воркера (cache-first или stale-while-revalidate), тот
 * сохранил бы сетевой ответ РАНЬШЕ, чем приложение успело его проверить, и
 * повреждённый JSON осел бы в кэше как рабочий. Тогда вся защита
 * last-known-good стала бы декоративной.
 *
 * Ротация версии строго в этом порядке:
 *
 *   получить → распарсить → провалидировать → previous = current → current = new
 *
 * При ошибке на любом шаге хранилище не меняется вообще.
 */

import { CLIENT_ID } from "./client-id.js";
import { validateCalendar } from "./validate.js";

// Имя базы содержит идентификатор клиента: IndexedDB делится по origin,
// и без него два календаря на одном устройстве писали бы в одну базу.
// Запасной путь через localStorage разводится сам — lsKey строит ключ отсюда.
const DB_NAME = `business-calendar-${CLIENT_ID}`;
const DB_VERSION = 1;
const STORE = "data";
const KEY_CURRENT = "current";
const KEY_PREVIOUS = "previous";

const DATA_URL = "./data/calendar.json";
const FETCH_TIMEOUT_MS = 6000;

// ---------------------------------------------------------------------------
// IndexedDB с откатом в localStorage
// ---------------------------------------------------------------------------
// На iOS в приватном режиме и в некоторых старых сборках IndexedDB может быть
// недоступна. Полностью терять офлайн из-за этого не хочется, поэтому есть
// запасной путь через localStorage.

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("IndexedDB недоступна"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("не удалось открыть IndexedDB"));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function lsKey(key) {
  return `${DB_NAME}:${key}`;
}

async function readSlot(key) {
  try {
    const value = await idbGet(key);
    if (value != null) return value;
  } catch {
    /* переходим к запасному пути */
  }
  try {
    const raw = localStorage.getItem(lsKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeSlot(key, value) {
  try {
    await idbSet(key, value);
    return;
  } catch {
    /* переходим к запасному пути */
  }
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(value));
  } catch (err) {
    // Квота или приватный режим. Данные останутся только в памяти —
    // приложение работает, но офлайн-запуск может не пережить перезагрузку.
    console.warn("не удалось сохранить данные локально:", err);
  }
}

// ---------------------------------------------------------------------------
// Публичный интерфейс
// ---------------------------------------------------------------------------

/** Подтверждённая копия из хранилища, либо null. */
export async function loadStored() {
  const stored = await readSlot(KEY_CURRENT);
  if (!stored) return null;

  // Проверяем даже своё: файл мог быть записан старой версией приложения
  // или повреждён на уровне хранилища.
  const verdict = validateCalendar(stored);
  if (!verdict.ok) {
    console.warn("сохранённые данные не прошли проверку:", verdict.reason);
    const previous = await readSlot(KEY_PREVIOUS);
    if (previous && validateCalendar(previous).ok) {
      console.warn("откатились на предыдущую версию данных");
      return previous;
    }
    return null;
  }
  return stored;
}

/**
 * Забирает свежий файл с сервера.
 *
 * cache: "no-store" обязателен: иначе браузер может месяцами отдавать свою
 * копию мимо всей нашей логики версий.
 */
export async function fetchFresh() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(DATA_URL, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, kind: "http", reason: `сервер ответил ${response.status}` };
    }

    const text = await response.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      // Самый частый случай — вместо JSON приехала HTML-страница ошибки.
      const looksLikeHtml = /^\s*</.test(text);
      return {
        ok: false,
        kind: "corrupt",
        reason: looksLikeHtml
          ? "вместо данных получена HTML-страница"
          : `файл не разбирается как JSON: ${err.message}`,
      };
    }

    const verdict = validateCalendar(parsed);
    if (!verdict.ok) {
      return { ok: false, kind: "invalid", reason: verdict.reason };
    }

    return { ok: true, data: parsed };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, kind: "timeout", reason: "сервер не ответил вовремя" };
    }
    return { ok: false, kind: "offline", reason: "нет соединения" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Сохраняет проверенные данные, сдвигая текущую версию в предыдущую.
 * Вызывается ТОЛЬКО после успешной валидации.
 */
export async function commit(data) {
  const current = await readSlot(KEY_CURRENT);
  if (current) await writeSlot(KEY_PREVIOUS, current);
  await writeSlot(KEY_CURRENT, data);
}

/** Есть ли вообще сохранённая копия — нужно для экрана первого запуска. */
export async function hasStored() {
  return (await readSlot(KEY_CURRENT)) != null;
}

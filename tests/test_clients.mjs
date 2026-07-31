/**
 * Изоляция клиентов в одном браузере.
 *
 * Cache Storage и IndexedDB делятся по origin, а не по пути. Два календаря
 * на username.github.io живут в одном хранилище, и без разведения
 * идентификаторов один показал бы офлайн данные другого, а чистка старых
 * кэшей у одного снесла бы офлайн-оболочку второго. Проверяем в настоящем
 * браузере: это ровно тот класс поломки, который не виден глазами.
 *
 * Запуск:  node tests/test_clients.mjs
 */

import { spawn } from "node:child_process";
import { chromium } from "playwright";

import { buildFixture } from "./build_fixture.mjs";

const PORT = 8124;
const BASE = `http://127.0.0.1:${PORT}`;

let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

function startServer(root) {
  return spawn(
    process.platform === "win32" ? "python" : "python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", root],
    { stdio: "ignore" },
  );
}

async function waitForServer(path) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/${path}/index.html`);
      if (r.ok) return;
    } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("локальный сервер не поднялся");
}

/**
 * Ждём не «столько-то миллисекунд», а именно того состояния, которое
 * проверяем: воркер управляет страницей и данные уже легли в базу. Иначе
 * тест читал бы пустую базу и зеленел бы по неправильной причине.
 */
async function waitReady(page, dbName) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    null, { timeout: 20000 });
  await page.waitForFunction(async (name) => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes(name)) return false;
    const db = await new Promise((resolve) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains("data")) return false;
    const value = await new Promise((resolve) => {
      const req = db.transaction("data", "readonly").objectStore("data").get("current");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    db.close();
    return Boolean(value);
  }, dbName, { timeout: 20000 });
}

async function main() {
  const root = await buildFixture(["a", "b"]);
  const server = startServer(root);
  await waitForServer("a");

  const browser = await chromium.launch();
  // Один контекст на обоих клиентов — это и есть «один телефон».
  const context = await browser.newContext();

  try {
    const pageA = await context.newPage();
    await pageA.goto(`${BASE}/a/`);
    await waitReady(pageA, "business-calendar-a");

    const pageB = await context.newPage();
    await pageB.goto(`${BASE}/b/`);
    await waitReady(pageB, "business-calendar-b");

    const dbs = await pageA.evaluate(async () =>
      (await indexedDB.databases()).map((d) => d.name).sort());
    check("базы IndexedDB разведены по клиентам",
      dbs.includes("business-calendar-a") && dbs.includes("business-calendar-b"),
      JSON.stringify(dbs));

    const cacheNames = await pageA.evaluate(async () => (await window.caches.keys()).sort());
    check("кэши оболочки разведены по клиентам",
      cacheNames.some((n) => n.startsWith("calendar-a-shell-")) &&
      cacheNames.some((n) => n.startsWith("calendar-b-shell-")),
      JSON.stringify(cacheNames));

    check("общего кэша calendar-shell- не осталось",
      !cacheNames.some((n) => n.startsWith("calendar-shell-")),
      JSON.stringify(cacheNames));

    // Данные не перетекают: подменяем содержимое базы клиента A и требуем,
    // чтобы у клиента B осталось своё. Без разведения имён обе страницы
    // читали бы одну запись, и подмена была бы видна обоим.
    await pageA.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const req = indexedDB.open("business-calendar-a");
        req.onsuccess = () => resolve(req.result);
      });
      await new Promise((resolve) => {
        const tx = db.transaction("data", "readwrite");
        tx.objectStore("data").put({ метка: "версия клиента A" }, "current");
        tx.oncomplete = resolve;
      });
      db.close();
    });

    const seenByB = await pageB.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const req = indexedDB.open("business-calendar-b");
        req.onsuccess = () => resolve(req.result);
      });
      const value = await new Promise((resolve) => {
        const req = db.transaction("data", "readonly")
          .objectStore("data").get("current");
        req.onsuccess = () => resolve(req.result);
      });
      db.close();
      return { marker: value && value["метка"], version: value && value.version };
    });
    check("подмена данных у клиента A не видна клиенту B",
      seenByB.marker !== "версия клиента A", JSON.stringify(seenByB));
    check("у клиента B на месте его собственный календарь",
      seenByB.version === 1, JSON.stringify(seenByB));

    // Главная проверка: подъём версии у одного не сносит оболочку другого.
    const before = await pageA.evaluate(async () => (await window.caches.keys()).sort());
    await pageA.evaluate(async () => {
      // Имитируем активацию новой версии воркера клиента A: он чистит
      // кэши по СВОЕМУ префиксу. Кэш клиента B обязан уцелеть.
      const names = await window.caches.keys();
      const mine = names.filter((n) => n.startsWith("calendar-a-shell-"));
      await Promise.all(mine.map((n) => window.caches.delete(n)));
    });
    const after = await pageA.evaluate(async () => (await window.caches.keys()).sort());
    check("чистка у клиента A не тронула кэш клиента B",
      after.some((n) => n.startsWith("calendar-b-shell-")),
      `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

    // Манифесты обязаны иметь разные id, иначе установка спутает приложения.
    const idA = await pageA.evaluate(async () =>
      (await (await fetch("./manifest.webmanifest")).json()).id);
    const idB = await pageB.evaluate(async () =>
      (await (await fetch("./manifest.webmanifest")).json()).id);
    check("id в манифестах разные", idA !== idB, `${idA} и ${idB}`);
    check("id абсолютные и указывают на папку клиента",
      idA === "/bc/a/" && idB === "/bc/b/", `${idA} и ${idB}`);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(failed ? `\n${failed} проверок упало` : "\nвсе проверки прошли");
  process.exit(failed ? 1 : 0);
}

main();

/**
 * Проверка опубликованного приложения на живом GitHub Pages.
 *
 * Отличается от test_app.mjs тем, что бьёт по настоящему адресу: здесь
 * проверяются вещи, которых нет на локальном сервере — относительные пути в
 * подкаталоге, регистрация service worker и работа офлайн после первого
 * визита.
 *
 * Запуск: node tests/test_live.mjs [url]
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, devices } from "playwright";

const BASE = process.argv[2] || "https://yaroslavmalygin.github.io/bc-2026-1/";
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, "..", ".tmp", "screens");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`${GREEN}✓${RESET} ${name}`);
  } else {
    failed++;
    console.log(`${RED}✗${RESET} ${name}`);
    if (detail) console.log(`    ${detail}`);
  }
}

function group(t) {
  console.log(`\n${BOLD}${t}${RESET}`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  console.log(`${DIM}адрес: ${BASE}${RESET}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["iPhone 15"],
    locale: "ru-RU",
    timezoneId: "Europe/Berlin",
    serviceWorkers: "allow",
  });
  const page = await context.newPage();

  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("requestfailed", (r) => requests.push(`${r.url()} — ${r.failure()?.errorText}`));

  try {
    group("Загрузка с боевого адреса");

    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.getElementById("curtain").hidden,
      { timeout: 20000 });

    check("приложение открылось", true);
    check("ошибок в консоли нет", errors.length === 0, errors.join("\n    "));
    check("все запросы прошли", requests.length === 0, requests.join("\n    "));

    const header = await page.locator("#barDay").innerText();
    check("шапка заполнена", header.length > 3, header);

    // Сегодня 30 июля 2026 — раньше начала диапазона, приложение обязано
    // прижаться к 1 августа и объяснить это.
    const banners = await page.locator(".banner").allInnerTexts();
    console.log(`${DIM}    показанная дата: ${header}${RESET}`);
    console.log(`${DIM}    плашки: ${banners.join(" | ") || "нет"}${RESET}`);

    const rows = await page.locator(".card[data-filled='1'] .row").count();
    check("строки дня отрисованы", rows > 0, `строк ${rows}`);

    await page.screenshot({ path: resolve(SHOTS, "50-live.png") });

    group("Относительные пути в подкаталоге");

    const urls = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel=manifest]')?.href,
      icon: document.querySelector('link[rel=apple-touch-icon]')?.href,
    }));
    check("манифест лежит внутри проекта",
      urls.manifest?.includes("/bc-2026-1/"), urls.manifest);
    check("иконка лежит внутри проекта",
      urls.icon?.includes("/bc-2026-1/"), urls.icon);

    const manifest = await page.evaluate(async (href) => {
      const r = await fetch(href);
      return r.ok ? r.json() : null;
    }, urls.manifest);
    check("манифест читается", manifest !== null);
    check("display: standalone", manifest?.display === "standalone", manifest?.display);
    check("orientation: portrait", manifest?.orientation === "portrait", manifest?.orientation);
    check("есть maskable-иконка",
      manifest?.icons?.some((i) => i.purpose === "maskable"));

    group("Service worker");

    const swReady = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg.active);
    }).catch(() => false);
    check("service worker активен", swReady);

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const out = {};
      for (const n of names) {
        const cache = await caches.open(n);
        out[n] = (await cache.keys()).map((r) => new URL(r.url).pathname);
      }
      return out;
    });

    const allCached = Object.values(cached).flat();
    check("оболочка попала в кэш",
      allCached.some((p) => p.endsWith("/app.js")), JSON.stringify(Object.keys(cached)));
    check("calendar.json в кэш воркера НЕ попал",
      !allCached.some((p) => p.includes("calendar.json")),
      allCached.filter((p) => p.includes("calendar")).join(", "));

    const stored = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("business-calendar", 1);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return new Promise((res) => {
        const tx = db.transaction("data", "readonly");
        const req = tx.objectStore("data").get("current");
        req.onsuccess = () => res(req.result ? Object.keys(req.result.days).length : 0);
        req.onerror = () => res(0);
      });
    }).catch(() => 0);
    check("данные сохранены приложением в своё хранилище", stored === 396, `дней ${stored}`);

    group("Офлайн после первого визита");

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("curtain").hidden,
      { timeout: 20000 }).catch(() => {});

    const offlineHeader = await page.locator("#barDay").innerText();
    const offlineRows = await page.locator(".card[data-filled='1'] .row").count();
    check("офлайн приложение открывается",
      offlineHeader === header && offlineRows > 0,
      `шапка «${offlineHeader}», строк ${offlineRows}`);

    const offlineBanner = await page.locator(".banner").allInnerTexts();
    check("белого экрана нет", await page.locator("#curtain").isHidden(),
      offlineBanner.join(" | "));

    await page.screenshot({ path: resolve(SHOTS, "51-live-offline.png") });
    await context.setOffline(false);

  } finally {
    await browser.close();
  }

  console.log(`\n${BOLD}Итог${RESET}`);
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}✓ боевой адрес: все ${passed} проверок пройдены${RESET}`);
    process.exit(0);
  }
  console.log(`${RED}${BOLD}✗ провалено ${failed} из ${passed + failed}${RESET}`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

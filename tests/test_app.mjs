/**
 * Проверка приложения в настоящем браузере.
 *
 * Закрывает раздел Verification из плана: один экран без вертикального
 * скролла на трёх размерах, крайние случаи с датой, поведение при битом
 * JSON (последняя рабочая версия обязана уцелеть), шторки, календарь,
 * лунные анонсы и просьба повернуть телефон.
 *
 * Запуск: node tests/test_app.mjs
 * Скриншоты складываются в .tmp/screens/
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, devices } from "playwright";

import { buildFixture } from "./build_fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SHOTS = resolve(ROOT, ".tmp", "screens");
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

// Клиент лежит в подпапке, а сервер поднимается над ней: так путь непустой
// и идентификатор клиента выводится по-настоящему, как на боевом адресе.
const CLIENT_DIR = "app-test";
const APP = `${BASE}/${CLIENT_DIR}`;

// Заполняется в main() до старта сервера — каталогом собранной фикстуры.
let SERVE_ROOT;

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

function ok(name, extra) {
  passed++;
  console.log(`${GREEN}✓${RESET} ${name}${extra ? ` ${DIM}${extra}${RESET}` : ""}`);
}

function bad(name, detail) {
  failed++;
  console.log(`${RED}✗${RESET} ${name}`);
  if (detail) console.log(`    ${detail}`);
}

function check(name, condition, detail) {
  if (condition) ok(name);
  else bad(name, detail);
}

function group(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

// ---------------------------------------------------------------------------

function startServer() {
  const proc = spawn(
    process.platform === "win32" ? "python" : "python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", SERVE_ROOT],
    { stdio: "ignore" },
  );
  return proc;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${APP}/index.html`);
      if (r.ok) return;
    } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("локальный сервер не поднялся");
}

/** Страница с зафиксированной датой и дождавшаяся готовности приложения. */
async function openApp(browser, { device, date, route } = {}) {
  const context = await browser.newContext({
    ...(device ? devices[device] : {}),
    locale: "ru-RU",
    timezoneId: "Europe/Berlin",
  });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  if (date) await page.clock.install({ time: new Date(date) });
  if (route) await route(page);

  await page.goto(`${APP}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const c = document.getElementById("curtain");
    return c && c.hidden;
  }, { timeout: 10000 }).catch(() => {});

  return { context, page, errors };
}

const dayHeader = (page) => page.locator("#barDay").innerText();

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  SERVE_ROOT = await buildFixture([CLIENT_DIR]);
  const server = startServer();
  await waitForServer();

  const data = JSON.parse(
    readFileSync(resolve(SERVE_ROOT, CLIENT_DIR, "data", "calendar.json"), "utf8"));
  const browser = await chromium.launch();

  try {
    // =====================================================================
    group("Обычный день внутри диапазона");
    {
      const { context, page, errors } = await openApp(browser, {
        device: "iPhone 15", date: "2026-08-12T09:00:00",
      });

      check("открывается сразу на сегодня",
        (await dayHeader(page)) === "12 августа 2026",
        `в шапке: ${await dayHeader(page)}`);

      check("ошибок в консоли нет", errors.length === 0, errors.join("\n    "));

      const rows = await page.locator(".card[data-day='2026-08-12'] .row").count();
      check("восемь строк дня", rows === 8, `найдено ${rows}`);

      const moonTitle = await page.locator("#moonTitle").innerText();
      check("12 августа — новолуние", moonTitle.includes("Новолуние сегодня"), moonTitle);

      await page.screenshot({ path: resolve(SHOTS, "01-day.png") });

      // --- один экран без вертикального скролла ---
      const scroll = await page.evaluate(() => ({
        body: document.body.scrollHeight - document.body.clientHeight,
        docH: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        horiz: document.body.scrollWidth - document.body.clientWidth,
      }));
      check("страница не скроллится вертикально",
        scroll.body <= 1 && scroll.docH <= 1, JSON.stringify(scroll));
      check("страница не скроллится горизонтально", scroll.horiz <= 1,
        `лишних ${scroll.horiz}px`);

      // --- свайп стрелками ---
      await page.locator("#nextBtn").click();
      await page.waitForTimeout(450);
      check("кнопка «вперёд» листает день",
        (await dayHeader(page)) === "13 августа 2026", await dayHeader(page));

      check("появилась кнопка «Сегодня»",
        await page.locator("#todayBtn").evaluate((n) => n.classList.contains("on")));

      await page.locator("#todayBtn").click();
      await page.waitForTimeout(600);
      check("«Сегодня» возвращает назад",
        (await dayHeader(page)) === "12 августа 2026", await dayHeader(page));

      // --- шторки ---
      await page.locator("#legBtn").click();
      await page.waitForTimeout(350);
      check("легенда открылась", await page.locator("#sheetLegend").isVisible());
      const legendScroll = await page.locator("#sheetLegend .sheet-body")
        .evaluate((n) => n.scrollHeight > n.clientHeight);
      check("у легенды собственный скролл", legendScroll);
      await page.screenshot({ path: resolve(SHOTS, "02-legend.png") });

      await page.keyboard.press("Escape");
      await page.waitForTimeout(450);
      check("Esc закрывает шторку", !(await page.locator("#sheetLegend").isVisible()));

      // --- прогноз ---
      await page.locator("#fcBtn").click();
      await page.waitForTimeout(350);
      check("прогноз открылся", await page.locator("#sheetForecast").isVisible());
      const fcTitle = await page.locator("#fcTitle").innerText();
      check("заголовок прогноза — нужный месяц", fcTitle === "Август 2026", fcTitle);
      await page.locator("#sheetForecast [data-close]").click();
      await page.waitForTimeout(450);

      // --- подробности строки ---
      await page.locator(".card[data-day='2026-08-12'] .row").first().click();
      await page.waitForTimeout(350);
      check("подробности строки открылись", await page.locator("#sheetDetail").isVisible());
      await page.screenshot({ path: resolve(SHOTS, "03-detail.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(450);

      // --- выбор даты ---
      await page.locator("#calBtn").click();
      await page.waitForTimeout(350);
      check("календарь открылся", await page.locator("#sheetCal").isVisible());
      await page.screenshot({ path: resolve(SHOTS, "04-calendar.png") });

      await page.locator("#calNext").click();
      await page.waitForTimeout(200);
      const calMonth = await page.locator("#calMonth").innerText();
      check("листание месяцев работает", calMonth === "Сентябрь 2026", calMonth);

      await page.locator("#calGrid .cal-cell:not(.empty)").nth(17).click();
      await page.waitForTimeout(500);
      check("прыжок по календарю попадает точно",
        (await dayHeader(page)) === "18 сентября 2026", await dayHeader(page));

      await context.close();
    }

    // =====================================================================
    group("Лунные анонсы");
    {
      const { context, page } = await openApp(browser, {
        device: "iPhone 15", date: "2026-08-12T09:00:00",
      });

      const cases = [
        ["2026-08-09", "Через 3 дня новолуние"],
        ["2026-08-10", "Через 2 дня новолуние"],
        ["2026-08-11", "Завтра новолуние"],
        ["2026-08-12", "Новолуние сегодня"],
        ["2026-08-25", "Через 3 дня полнолуние"],
        ["2026-08-27", "Завтра полнолуние"],
        ["2026-08-28", "Полнолуние сегодня"],
      ];

      // Прокрутку ПОВТОРЯЕМ, а не просто ждём после неё. Сразу после
      // загрузки приложение само доцентровывается на «сегодня» и отменяет
      // нашу прокрутку — ожидание тут не помогает, потому что ждать нечего:
      // подпись честно показывает тот день, на который приложение вернулось.
      // Ложное падение ловилось на первом же дне примерно в трети прогонов.
      const showDay = async (key, expected) => {
        for (let attempt = 0; attempt < 10; attempt++) {
          await page.evaluate((k) => {
            document.querySelector(`.card[data-day="${k}"]`)
              ?.scrollIntoView({ behavior: "instant", inline: "center" });
          }, key);
          const shown = await page.waitForFunction(
            (t) => document.getElementById("moonTitle").innerText === t,
            expected, { timeout: 600 },
          ).then(() => true).catch(() => false);
          if (shown) return;
        }
      };

      for (const [key, expected] of cases) {
        await showDay(key, expected);
        const title = await page.locator("#moonTitle").innerText();
        check(`${key}: ${expected}`, title === expected, `получено: ${title}`);
      }

      // Освещённость обязана нарастать к полнолунию
      const percents = [];
      for (const key of ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]) {
        await page.evaluate((k) => {
          document.querySelector(`.card[data-day="${k}"]`)
            .scrollIntoView({ behavior: "instant", inline: "center" });
        }, key);
        await page.waitForTimeout(200);
        const sub = await page.locator("#moonSub").innerText();
        percents.push(Number(sub.replace(/\D+/g, "")));
      }
      const rising = percents.every((v, i) => i === 0 || v >= percents[i - 1]);
      check("освещённость растёт к полнолунию", rising && percents.at(-1) === 100,
        percents.join(" → "));

      await page.screenshot({ path: resolve(SHOTS, "05-moon.png") });
      await context.close();
    }

    // =====================================================================
    group("Один экран на разных телефонах");
    {
      const targets = [
        ["iPhone SE", { width: 375, height: 667 }],
        ["iPhone 15", { width: 393, height: 852 }],
        ["Pixel 8", { width: 412, height: 915 }],
        ["крупный шрифт", { width: 393, height: 852, zoom: 1.3 }],
      ];

      for (const [name, size] of targets) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
          locale: "ru-RU",
          timezoneId: "Europe/Berlin",
        });
        const page = await context.newPage();
        await page.clock.install({ time: new Date("2026-08-12T09:00:00") });
        if (size.zoom) {
          await page.addInitScript((z) => {
            document.addEventListener("DOMContentLoaded", () => {
              document.documentElement.style.fontSize = `${16 * z}px`;
            });
          }, size.zoom);
        }
        await page.goto(`${APP}/index.html`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.getElementById("curtain").hidden,
          { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);

        const m = await page.evaluate(() => ({
          v: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          h: document.body.scrollWidth - document.body.clientWidth,
          rows: document.querySelectorAll(".card[data-filled='1'] .row").length > 0,
          cramped: document.getElementById("app").classList.contains("cramped"),
        }));

        check(`${name}: без вертикального скролла`, m.v <= 1, `лишних ${m.v}px`);
        check(`${name}: без горизонтального скролла`, m.h <= 1, `лишних ${m.h}px`);
        check(`${name}: строки отрисованы`, m.rows);

        await page.screenshot({
          path: resolve(SHOTS, `10-${name.replace(/\s+/g, "-")}.png`),
        });
        await context.close();
      }
    }

    // =====================================================================
    group("Крайние случаи с датой");
    {
      // Сегодня раньше начала диапазона — это происходит прямо сейчас
      const before = await openApp(browser, {
        device: "iPhone 15", date: "2026-07-30T09:00:00",
      });
      check("дата до диапазона прижимается к началу",
        (await dayHeader(before.page)) === "1 августа 2026",
        await dayHeader(before.page));
      const banner1 = await before.page.locator(".banner").first().innerText();
      check("объяснение показано", banner1.includes("начинается"), banner1);
      check("кнопка «Сегодня» скрыта",
        !(await before.page.locator("#todayBtn").evaluate((n) => n.classList.contains("on"))));
      await before.page.screenshot({ path: resolve(SHOTS, "20-before-range.png") });
      await before.context.close();

      // Сегодня после конца диапазона
      const after = await openApp(browser, {
        device: "iPhone 15", date: "2027-09-15T09:00:00",
      });
      check("дата после диапазона прижимается к концу",
        (await dayHeader(after.page)) === "31 августа 2027",
        await dayHeader(after.page));
      const banners2 = await after.page.locator(".banner").allInnerTexts();
      check("предложено обновить данные",
        banners2.some((b) => b.includes("закончился")), banners2.join(" | "));
      await after.page.screenshot({ path: resolve(SHOTS, "21-after-range.png") });
      await after.context.close();

      // Предупреждение за 30 дней до конца
      const soon = await openApp(browser, {
        device: "iPhone 15", date: "2027-08-20T09:00:00",
      });
      const banners = await soon.page.locator(".banner").allInnerTexts();
      check("предупреждение за месяц до конца",
        banners.some((b) => b.includes("осталось")), banners.join(" | "));
      await soon.context.close();

      // Переход через полночь при свёрнутом приложении
      const midnight = await openApp(browser, {
        device: "iPhone 15", date: "2026-08-12T23:59:30",
      });
      check("вечером показан текущий день",
        (await dayHeader(midnight.page)) === "12 августа 2026");
      await midnight.page.clock.setFixedTime(new Date("2026-08-13T00:00:30"));
      await midnight.page.evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await midnight.page.waitForTimeout(400);
      check("после полуночи день сменился сам",
        (await dayHeader(midnight.page)) === "13 августа 2026",
        await dayHeader(midnight.page));
      await midnight.context.close();
    }

    // =====================================================================
    group("Ориентация");
    {
      const context = await browser.newContext({
        viewport: { width: 852, height: 393 },
        isMobile: true, hasTouch: true, locale: "ru-RU",
      });
      const page = await context.newPage();
      await page.clock.install({ time: new Date("2026-08-12T09:00:00") });
      await page.goto(`${APP}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);

      check("в landscape показана просьба повернуть",
        await page.locator("#rotateOverlay").isVisible());
      await page.screenshot({ path: resolve(SHOTS, "30-landscape.png") });

      await page.setViewportSize({ width: 393, height: 852 });
      await page.waitForTimeout(500);
      check("после возврата в portrait просьба исчезла",
        !(await page.locator("#rotateOverlay").isVisible()));
      check("день сохранился", (await dayHeader(page)) === "12 августа 2026",
        await dayHeader(page));
      await context.close();
    }

    // =====================================================================
    group("Битый JSON: последняя рабочая версия обязана уцелеть");
    {
      const scenarios = [
        ["404", (r) => r.fulfill({ status: 404, body: "not found" })],
        ["HTML вместо JSON", (r) => r.fulfill({
          status: 200, contentType: "text/html",
          body: "<!doctype html><html><body>404</body></html>",
        })],
        ["синтаксически битый JSON", (r) => r.fulfill({
          status: 200, contentType: "application/json", body: '{"version":1,',
        })],
        ["обрезанный, но валидный JSON", (r) => {
          const cut = JSON.parse(JSON.stringify(data));
          const keys = Object.keys(cut.days);
          for (const k of keys.slice(200)) delete cut.days[k];
          return r.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify(cut) });
        }],
        ["неизвестная версия", (r) => {
          const v = JSON.parse(JSON.stringify(data));
          v.version = 99;
          return r.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify(v) });
        }],
        ["день без части строк", (r) => {
          const v = JSON.parse(JSON.stringify(data));
          delete v.days["2026-09-10"].cells.haircut;
          return r.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify(v) });
        }],
        ["ссылка на несуществующую строку", (r) => {
          const v = JSON.parse(JSON.stringify(data));
          v.days["2026-09-11"].cells.unicorn = { c: "good", m: "" };
          return r.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify(v) });
        }],
      ];

      for (const [name, handler] of scenarios) {
        // Первый заход — здоровый: приложение сохраняет рабочую копию.
        const context = await browser.newContext({
          ...devices["iPhone 15"], locale: "ru-RU", timezoneId: "Europe/Berlin",
        });
        const page = await context.newPage();
        await page.clock.install({ time: new Date("2026-08-12T09:00:00") });
        await page.goto(`${APP}/index.html`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.getElementById("curtain").hidden,
          { timeout: 10000 });

        // Второй заход — с подменённым файлом.
        await page.route("**/data/calendar.json", handler);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);

        const header = await dayHeader(page);
        const curtainHidden = await page.locator("#curtain").isHidden();
        // Строки считаем в карточке текущего дня: в окне наполнено сразу
        // несколько соседних, и общий счёт ничего не сказал бы.
        const rows = await page.locator(".card[data-day='2026-08-12'] .row").count();

        check(`${name}: календарь остался рабочим`,
          curtainHidden && header === "12 августа 2026" && rows === 8,
          `шапка «${header}», строк ${rows}, шторка скрыта: ${curtainHidden}`);

        await context.close();
      }
    }

    // =====================================================================
    group("Первый запуск без сети и без сохранённых данных");
    {
      const context = await browser.newContext({
        ...devices["iPhone 15"], locale: "ru-RU", timezoneId: "Europe/Berlin",
      });
      const page = await context.newPage();
      await page.clock.install({ time: new Date("2026-08-12T09:00:00") });
      await page.route("**/data/calendar.json", (r) => r.abort("failed"));
      await page.goto(`${APP}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);

      const visible = await page.locator("#curtain").isVisible();
      const title = await page.locator("#curtainTitle").innerText();
      check("показан понятный экран, а не белое полотно",
        visible && title.includes("Нет интернета"), `${visible} / ${title}`);
      check("есть кнопка повторить",
        await page.locator("#curtainBtn").isVisible());
      await page.screenshot({ path: resolve(SHOTS, "40-first-run-offline.png") });
      await context.close();
    }

    // =====================================================================
    group("Производительность первой отрисовки");
    {
      const context = await browser.newContext({
        ...devices["iPhone 15"], locale: "ru-RU", timezoneId: "Europe/Berlin",
      });
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      // Эмулируем слабое устройство: вчетверо медленнее процессора.
      await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.clock.install({ time: new Date("2026-08-12T09:00:00") });

      const t0 = Date.now();
      await page.goto(`${APP}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.getElementById("curtain").hidden,
        { timeout: 20000 });
      const elapsed = Date.now() - t0;

      const domNodes = await page.evaluate(() => document.querySelectorAll("*").length);
      const filled = await page.evaluate(
        () => document.querySelectorAll(".card[data-filled='1']").length);

      ok("время до готовности при вчетверо замедленном процессоре", `${elapsed} мс`);
      ok("узлов в DOM", String(domNodes));
      check("наполнено только окно вокруг текущего дня", filled <= 7 + 1,
        `наполнено карточек: ${filled}`);
      check("карточек в колоде ровно по числу дней",
        (await page.locator(".card").count()) === Object.keys(data.days).length);

      await context.close();
    }

    // =====================================================================
    group("Доступность шторок");
    {
      const { context, page } = await openApp(browser, {
        device: "iPhone 15", date: "2026-08-12T09:00:00",
      });

      await page.locator("#legBtn").click();
      await page.waitForTimeout(350);

      const a11y = await page.evaluate(() => {
        const sheet = document.getElementById("sheetLegend");
        const deck = document.getElementById("deck");
        return {
          role: sheet.getAttribute("role"),
          modal: sheet.getAttribute("aria-modal"),
          labelled: Boolean(sheet.getAttribute("aria-labelledby")),
          bgInert: deck.inert === true,
          focusInside: sheet.contains(document.activeElement),
        };
      });

      check("role=dialog", a11y.role === "dialog");
      check("aria-modal=true", a11y.modal === "true");
      check("aria-labelledby задан", a11y.labelled);
      check("фон отключён через inert", a11y.bgInert);
      check("фокус перенесён внутрь шторки", a11y.focusInside);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(450);
      const restored = await page.evaluate(
        () => document.activeElement === document.getElementById("legBtn"));
      check("фокус вернулся на исходную кнопку", restored);
      const bgBack = await page.evaluate(() => document.getElementById("deck").inert);
      check("фон снова доступен", bgBack === false);

      await context.close();
    }

    // =====================================================================
    group("Фон не двигается при открытии шторки");
    /*
     * Фокус внутрь шторки, пока та ещё за нижним краем экрана, заставлял
     * браузер доскроллить .app до неё: интерфейс уезжал на ~370px вверх и
     * полз обратно, пока шторка выезжала. На телефоне это выглядело дрожью
     * фона. `overflow: hidden` тут не защита — он запрещает скролл пальцем,
     * а не программный, поэтому проверяем измерением, а не наличием стиля.
     */
    {
      const { context, page } = await openApp(browser, {
        device: "iPhone 15", date: "2026-08-12T09:00:00",
      });

      // Наблюдатель ставится ДО клика: съезд длится считаные кадры и к
      // моменту следующей команды Playwright уже раскручивается назад.
      const watch = () => page.evaluate(() => {
        window.__drift = [];
        const app = document.getElementById("app");
        const tick = () => {
          window.__drift.push(Math.round(
            Math.max(app.scrollTop, -document.querySelector(".topbar").getBoundingClientRect().top)));
          if (window.__drift.length < 45) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      for (const [label, id] of [["календарь", "calBtn"], ["легенда", "legBtn"], ["прогноз", "fcBtn"]]) {
        await watch();
        await page.locator(`#${id}`).click();
        await page.waitForTimeout(700);
        const drift = await page.evaluate(() => Math.max(...window.__drift));
        check(`${label}: фон стоит на месте`, drift === 0, `сдвиг ${drift}px`);

        await watch();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(700);
        const back = await page.evaluate(() => Math.max(...window.__drift));
        check(`${label}: фон стоит и при закрытии`, back === 0, `сдвиг ${back}px`);
      }

      await context.close();
    }

  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${BOLD}Итог${RESET}`);
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}✓ все проверки пройдены: ${passed}${RESET}`);
    console.log(`${DIM}скриншоты: ${SHOTS}${RESET}`);
    process.exit(0);
  }
  console.log(`${RED}${BOLD}✗ провалено ${failed} из ${passed + failed}${RESET}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

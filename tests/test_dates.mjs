/**
 * Тесты модуля дат.
 *
 * Основное внимание — местам, где обычные реализации тихо ошибаются:
 * переходы на летнее и зимнее время, момент около полуночи, отрицательные
 * и положительные часовые пояса, границы месяцев и годов.
 *
 * Запуск (один пояс):    node tests/test_dates.mjs
 * Запуск во всех поясах: node tests/test_dates.mjs --all-zones
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import * as D from "../docs/dates.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`${RED}✗${RESET} ${name}`);
    console.log(`    получено: ${a}`);
    console.log(`    ожидалось: ${e}`);
  }
}

function throws(name, fn) {
  try {
    fn();
    failed++;
    console.log(`${RED}✗${RESET} ${name}: исключения не было`);
  } catch {
    passed++;
  }
}

function group(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

// ---------------------------------------------------------------------------

group("Ключи и разбор");

check("makeKey дополняет нулями", D.makeKey(2026, 8, 1), "2026-08-01");
check("parseKey разбирает", D.parseKey("2026-08-12"), { year: 2026, month: 8, day: 12 });
throws("parseKey отвергает мусор", () => D.parseKey("12.08.2026"));
throws("parseKey отвергает 13-й месяц", () => D.parseKey("2026-13-01"));
throws("parseKey отвергает 31 февраля", () => D.parseKey("2027-02-31"));
check("29 февраля 2028 существует", D.parseKey("2028-02-29").day, 29);
throws("29 февраля 2027 не существует", () => D.parseKey("2027-02-29"));

group("Длина месяца");

check("февраль 2027 — не високосный", D.daysInMonth(2027, 2), 28);
check("февраль 2028 — високосный", D.daysInMonth(2028, 2), 29);
check("февраль 2100 — не високосный", D.daysInMonth(2100, 2), 28);
check("февраль 2000 — високосный", D.daysInMonth(2000, 2), 29);
check("сентябрь — 30", D.daysInMonth(2026, 9), 30);
check("август — 31", D.daysInMonth(2026, 8), 31);

group("Сложение календарных дней");

check("+1 внутри месяца", D.addDays("2026-08-12", 1), "2026-08-13");
check("−1 внутри месяца", D.addDays("2026-08-12", -1), "2026-08-11");
check("через конец месяца", D.addDays("2026-08-31", 1), "2026-09-01");
check("через начало месяца назад", D.addDays("2026-09-01", -1), "2026-08-31");
check("через конец года", D.addDays("2026-12-31", 1), "2027-01-01");
check("через начало года назад", D.addDays("2027-01-01", -1), "2026-12-31");
check("конец февраля 2027", D.addDays("2027-02-28", 1), "2027-03-01");
check("шаг ноль", D.addDays("2026-08-12", 0), "2026-08-12");
check("большой шаг вперёд", D.addDays("2026-08-01", 395), "2027-08-31");
check("большой шаг назад", D.addDays("2027-08-31", -395), "2026-08-01");

group("Переходы на летнее и зимнее время");

// В Европе переход происходит в последнее воскресенье марта и октября.
// Реализация на +86400000 мс здесь промахивается на день.
check("весенний перевод, Европа", D.addDays("2027-03-27", 1), "2027-03-28");
check("через весенний перевод", D.addDays("2027-03-28", 1), "2027-03-29");
check("осенний перевод, Европа", D.addDays("2026-10-24", 1), "2026-10-25");
check("через осенний перевод", D.addDays("2026-10-25", 1), "2026-10-26");
// В США переходы в другие даты — проверяем и их.
check("весенний перевод, США", D.addDays("2027-03-14", 1), "2027-03-15");
check("осенний перевод, США", D.addDays("2026-11-01", 1), "2026-11-02");
// Южное полушарие, обратный порядок.
check("перевод в Австралии", D.addDays("2026-10-04", 1), "2026-10-05");

group("Разница и сравнение");

check("разница через год", D.diffDays("2026-08-01", "2027-08-31"), 395);
check("разница нулевая", D.diffDays("2026-08-12", "2026-08-12"), 0);
check("разница отрицательная", D.diffDays("2026-08-12", "2026-08-10"), -2);
check("разница через весенний перевод", D.diffDays("2027-03-27", "2027-03-29"), 2);
check("разница через осенний перевод", D.diffDays("2026-10-24", "2026-10-26"), 2);
check("compare меньше", D.compare("2026-08-01", "2026-08-02"), -1);
check("compare равно", D.compare("2026-08-01", "2026-08-01"), 0);
check("compare больше", D.compare("2026-09-01", "2026-08-31"), 1);

group("Границы диапазона");

const MIN = "2026-08-01";
const MAX = "2027-08-31";
check("clamp снизу", D.clamp("2026-07-30", MIN, MAX), MIN);
check("clamp сверху", D.clamp("2027-09-05", MIN, MAX), MAX);
check("clamp внутри", D.clamp("2026-12-25", MIN, MAX), "2026-12-25");
check("isBetween до", D.isBetween("2026-07-31", MIN, MAX), false);
check("isBetween на границе", D.isBetween(MIN, MIN, MAX), true);
check("isBetween после", D.isBetween("2027-09-01", MIN, MAX), false);

group("Дни недели");

// 1 августа 2026 — суббота. Это опорная точка всей августовской сетки.
check("1 августа 2026 — суббота", D.weekdayShort("2026-08-01"), "сб");
check("2 августа 2026 — воскресенье", D.weekdayShort("2026-08-02"), "вс");
check("3 августа 2026 — понедельник", D.weekdayShort("2026-08-03"), "пн");
check("12 августа 2026 — среда", D.weekdayFull("2026-08-12"), "среда");
check("выходной в субботу", D.isWeekend("2026-08-01"), true);
check("выходной в воскресенье", D.isWeekend("2026-08-02"), true);
check("будни в понедельник", D.isWeekend("2026-08-03"), false);
check("индекс понедельника — 0", D.weekdayIndex("2026-08-03"), 0);
check("индекс воскресенья — 6", D.weekdayIndex("2026-08-02"), 6);

group("Месяцы");

check("monthKey из дня", D.monthKey("2026-08-12"), "2026-08");
check("addMonths вперёд", D.addMonths("2026-08", 1), "2026-09");
check("addMonths через год", D.addMonths("2026-12", 1), "2027-01");
check("addMonths назад через год", D.addMonths("2027-01", -1), "2026-12");
check("addMonths на 12", D.addMonths("2026-08", 12), "2027-08");
check("addMonths назад на 13", D.addMonths("2027-08", -13), "2026-07");
check("первый день месяца", D.firstDayOfMonth("2026-09"), "2026-09-01");

group("Форматирование");

check("длинная дата", D.formatLong("2026-08-12"), "12 августа 2026");
check("короткая дата", D.formatShort("2026-08-12"), "12 августа");
check("название месяца", D.formatMonth("2026-08"), "Август 2026");
check("родительный падеж месяца", D.monthGenitive("2026-08"), "августа");
// «Прогноз на август», а не «на августа» — падеж здесь винительный
check("винительный падеж месяца", D.monthAccusative("2026-08"), "август");
check("винительный: сентябрь", D.monthAccusative("2026-09"), "сентябрь");
check("винительный: май", D.monthAccusative("2027-05"), "май");
check("1 день", D.pluralDays(1), "1 день");
check("2 дня", D.pluralDays(2), "2 дня");
check("3 дня", D.pluralDays(3), "3 дня");
check("5 дней", D.pluralDays(5), "5 дней");
check("11 дней", D.pluralDays(11), "11 дней");
check("21 день", D.pluralDays(21), "21 день");

group("Сегодняшний день по локальной дате");

// todayKey обязан брать локальные компоненты. Проверяем момент, который
// в UTC приходится на другую календарную дату: 23:30 местного времени.
const lateEvening = new Date(2026, 7, 12, 23, 30, 0);
check("поздний вечер остаётся тем же днём", D.todayKey(lateEvening), "2026-08-12");

const earlyMorning = new Date(2026, 7, 12, 0, 30, 0);
check("раннее утро остаётся тем же днём", D.todayKey(earlyMorning), "2026-08-12");

const justBeforeMidnight = new Date(2026, 7, 12, 23, 59, 59);
check("за секунду до полуночи", D.todayKey(justBeforeMidnight), "2026-08-12");

const justAfterMidnight = new Date(2026, 7, 13, 0, 0, 1);
check("через секунду после полуночи", D.todayKey(justAfterMidnight), "2026-08-13");

// ---------------------------------------------------------------------------

const isChild = process.argv.includes("--child");
const wantAllZones = process.argv.includes("--all-zones");

console.log(
  `\n${BOLD}Пояс ${process.env.TZ || "по умолчанию"}:${RESET} ` +
  (failed === 0 ? `${GREEN}${passed} проверок пройдено${RESET}`
                : `${RED}провалено ${failed} из ${passed + failed}${RESET}`),
);

if (isChild || !wantAllZones) {
  process.exit(failed === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Прогон в разных часовых поясах
// ---------------------------------------------------------------------------

const self = fileURLToPath(import.meta.url);

// Крайние пояса плюс два с получасовым и 45-минутным смещением: они ловят
// ошибки, которые целые часы пропускают.
const ZONES = [
  "Etc/GMT-12",        // UTC+12, самый восточный
  "Pacific/Kiritimati", // UTC+14
  "Etc/GMT+11",        // UTC−11, самый западный
  "Asia/Kolkata",      // UTC+05:30
  "Asia/Kathmandu",    // UTC+05:45
  "Pacific/Chatham",   // UTC+12:45 с переходом на летнее время
  "Europe/Moscow",
  "Europe/Berlin",
  "America/New_York",
  "Australia/Sydney",
  "UTC",
];

group("Прогон во всех часовых поясах");

let zonesFailed = 0;
for (const tz of ZONES) {
  try {
    execFileSync(process.execPath, [self, "--child"], {
      env: { ...process.env, TZ: tz },
      stdio: "pipe",
    });
    console.log(`${GREEN}✓${RESET} ${tz}`);
  } catch (err) {
    zonesFailed++;
    console.log(`${RED}✗${RESET} ${tz}`);
    console.log(`${DIM}${String(err.stdout || "").trim()}${RESET}`);
  }
}

group("Один и тот же физический момент в разных поясах");

// Здесь календарные даты ОБЯЗАНЫ различаться: это не баг, а корректное
// поведение — «сегодня» определяется по локальной дате устройства.
const moment = "2026-08-12T10:00:00Z";
const seen = new Map();
for (const tz of ["Etc/GMT-12", "Etc/GMT+11"]) {
  const out = execFileSync(
    process.execPath,
    ["-e", `console.log(new Date("${moment}").getFullYear()+"-"+
      String(new Date("${moment}").getMonth()+1).padStart(2,"0")+"-"+
      String(new Date("${moment}").getDate()).padStart(2,"0"))`],
    { env: { ...process.env, TZ: tz }, encoding: "utf8" },
  ).trim();
  seen.set(tz, out);
  console.log(`  ${tz}: ${out}`);
}

const dates = [...seen.values()];
if (new Set(dates).size === 1) {
  console.log(`${DIM}  (в этот момент даты совпали — тоже допустимо)${RESET}`);
} else {
  console.log(`${GREEN}✓${RESET} даты различаются, как и должно быть`);
}

console.log();
if (zonesFailed === 0 && failed === 0) {
  console.log(`${GREEN}${BOLD}✓ модуль дат: все пояса пройдены${RESET}`);
  process.exit(0);
}
console.log(`${RED}${BOLD}✗ провалено поясов: ${zonesFailed}${RESET}`);
process.exit(1);

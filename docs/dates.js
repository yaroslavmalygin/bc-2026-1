/**
 * Работа с календарными датами. Единственное место в приложении, где это
 * разрешено: снаружи ручной арифметики по датам быть не должно.
 *
 * Внутренний идентификатор дня — строка "YYYY-MM-DD" в ЛОКАЛЬНОМ календаре
 * устройства. Три вещи запрещены и здесь не используются:
 *
 *   new Date("2026-08-12")   строка вида YYYY-MM-DD парсится как UTC-полночь,
 *                            и западнее Гринвича это даёт предыдущий день;
 *
 *   toISOString()            переводит в UTC, поэтому часть суток отдаёт
 *                            соседнюю дату;
 *
 *   +86400000                в сутках бывает 23 или 25 часов на переходах
 *                            летнего и зимнего времени, и прибавление
 *                            «ровно суток» уводит дату.
 *
 * Всё календарное сложение идёт через компоненты даты, а не через миллисекунды.
 */

const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

// Индекс 0 — понедельник: getDay() возвращает 0 для воскресенья, поэтому
// везде используется приведённый индекс, см. weekdayIndex.
const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const WEEKDAY_FULL = [
  "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
];

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

/** Ключ дня из года, месяца (1–12) и числа. */
export function makeKey(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Разбор ключа в {year, month, day}. Бросает на некорректном формате. */
export function parseKey(key) {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`некорректный ключ дня: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new Error(`некорректный месяц в ключе: ${key}`);
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`в ${year}-${pad(month)} нет дня ${day}`);
  }
  return { year, month, day };
}

/**
 * Ключ сегодняшнего дня по ЛОКАЛЬНОЙ дате устройства.
 *
 * Именно локальной: при поездке в другую страну календарь переключается
 * вместе с датой телефона. Даты, размеченные астрологом, при этом между
 * поясами не пересчитываются — 2026-08-12 остаётся 2026-08-12.
 */
export function todayKey(now = new Date()) {
  return makeKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Число дней в месяце. Февраль високосного года — 29. */
export function daysInMonth(year, month) {
  // День 0 следующего месяца — это последний день текущего.
  return new Date(year, month, 0).getDate();
}

/**
 * Прибавление календарных дней.
 *
 * Считается через локальный конструктор Date(y, m, d), который сам
 * нормализует переполнение: Date(2026, 0, 32) — это 1 февраля. Переходы на
 * летнее время при этом не влияют, потому что мы не трогаем миллисекунды.
 */
export function addDays(key, delta) {
  const { year, month, day } = parseKey(key);
  const d = new Date(year, month - 1, day + delta);
  return makeKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Разница в календарных днях: b минус a. */
export function diffDays(a, b) {
  const pa = parseKey(a);
  const pb = parseKey(b);
  // UTC здесь безопасен: обе даты переводятся одинаково, поэтому смещение
  // сокращается, а летнее время в UTC отсутствует по определению.
  const ms = Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.round(ms / 86400000);
}

/** -1, 0 или 1. Ключи лексикографически сравнимы, чем и пользуемся. */
export function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clamp(key, min, max) {
  if (compare(key, min) < 0) return min;
  if (compare(key, max) > 0) return max;
  return key;
}

export function isBetween(key, min, max) {
  return compare(key, min) >= 0 && compare(key, max) <= 0;
}

/** 0 — понедельник … 6 — воскресенье. */
export function weekdayIndex(key) {
  const { year, month, day } = parseKey(key);
  return (new Date(year, month - 1, day).getDay() + 6) % 7;
}

export function isWeekend(key) {
  return weekdayIndex(key) >= 5;
}

export function weekdayShort(key) {
  return WEEKDAY_SHORT[weekdayIndex(key)];
}

export function weekdayFull(key) {
  return WEEKDAY_FULL[weekdayIndex(key)];
}

/** Ключ месяца "YYYY-MM" для дня или для пары год-месяц. */
export function monthKey(key) {
  return key.slice(0, 7);
}

export function makeMonthKey(year, month) {
  return `${pad(year, 4)}-${pad(month)}`;
}

export function parseMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m };
}

export function addMonths(monthKeyStr, delta) {
  const { year, month } = parseMonthKey(monthKeyStr);
  const total = year * 12 + (month - 1) + delta;
  return makeMonthKey(Math.floor(total / 12), (total % 12) + 1);
}

/** Первый день месяца как ключ дня. */
export function firstDayOfMonth(monthKeyStr) {
  return `${monthKeyStr}-01`;
}

/** «12 августа 2026» */
export function formatLong(key) {
  const { year, month, day } = parseKey(key);
  return `${day} ${MONTHS_GEN[month - 1]} ${year}`;
}

/** «12 августа» */
export function formatShort(key) {
  const { year, month, day } = parseKey(key);
  void year;
  return `${day} ${MONTHS_GEN[month - 1]}`;
}

/** «Август 2026» */
export function formatMonth(monthKeyStr) {
  const { year, month } = parseMonthKey(monthKeyStr);
  return `${MONTHS_NOM[month - 1]} ${year}`;
}

/** «августа» — родительный падеж, для дат вида «12 августа». */
export function monthGenitive(monthKeyStr) {
  const { month } = parseMonthKey(monthKeyStr);
  return MONTHS_GEN[month - 1];
}

/**
 * «август» — винительный падеж, для оборота «Прогноз на …».
 *
 * У месяцев он совпадает с именительным, но подставлять сюда родительный
 * нельзя: получится «Прогноз на августа».
 */
export function monthAccusative(monthKeyStr) {
  const { month } = parseMonthKey(monthKeyStr);
  return MONTHS_NOM[month - 1].toLowerCase();
}

/** Правильное окончание: 1 день, 2 дня, 5 дней. */
export function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

export const NAMES = { MONTHS_NOM, MONTHS_GEN, WEEKDAY_SHORT, WEEKDAY_FULL };

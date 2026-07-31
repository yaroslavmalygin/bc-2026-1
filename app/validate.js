/**
 * Проверка calendar.json перед тем, как ему поверить.
 *
 * Успешный HTTP-ответ ничего не гарантирует: сервер умеет отдать HTML-страницу
 * ошибки со статусом 200, а оборванная загрузка — синтаксически корректный, но
 * обрезанный JSON. Поэтому здесь повторяются основные структурные проверки
 * конвертера, а не только «распарсилось — значит годится».
 *
 * Возвращает { ok: true } либо { ok: false, reason } с человекочитаемой
 * причиной. Невалидные данные никогда не заменяют последнюю рабочую копию.
 */

import { addDays, compare, daysInMonth, parseKey } from "./dates.js";

const SUPPORTED_VERSION = 1;
const COLORS = new Set(["good", "neutral", "bad", "none"]);
const MOON_TYPES = new Set(["new", "full"]);
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function bad(reason) {
  return { ok: false, reason };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Полная структурная проверка. */
export function validateCalendar(data) {
  if (!isPlainObject(data)) return bad("данные не являются объектом");

  if (data.version !== SUPPORTED_VERSION) {
    return bad(`версия формата ${data.version}, поддерживается ${SUPPORTED_VERSION}`);
  }

  for (const field of ["range", "rows", "months", "days", "moonEvents", "legend"]) {
    if (data[field] == null) return bad(`нет обязательного поля «${field}»`);
  }

  if (typeof data.provisional !== "boolean") {
    return bad("поле provisional должно быть булевым");
  }
  if (typeof data.dataHash !== "string" || !HASH_RE.test(data.dataHash)) {
    return bad("dataHash отсутствует или имеет неожиданный формат");
  }

  // --- Диапазон -----------------------------------------------------------
  const { start, end } = data.range || {};
  if (typeof start !== "string" || typeof end !== "string") {
    return bad("range.start или range.end не строка");
  }
  try {
    parseKey(start);
    parseKey(end);
  } catch (err) {
    return bad(`некорректная граница диапазона: ${err.message}`);
  }
  if (compare(start, end) >= 0) return bad("range.start не раньше range.end");

  // --- Строки -------------------------------------------------------------
  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    return bad("список строк пуст");
  }
  const rowIds = new Set();
  for (const row of data.rows) {
    if (!isPlainObject(row) || typeof row.id !== "string" || !row.id) {
      return bad("у строки нет идентификатора");
    }
    if (rowIds.has(row.id)) return bad(`идентификатор строки «${row.id}» повторяется`);
    if (typeof row.label !== "string" || !row.label) {
      return bad(`у строки «${row.id}» нет подписи`);
    }
    rowIds.add(row.id);
  }

  // --- Месяцы -------------------------------------------------------------
  if (!Array.isArray(data.months) || data.months.length === 0) {
    return bad("список месяцев пуст");
  }
  const monthKeys = [];
  for (const m of data.months) {
    if (!isPlainObject(m) || typeof m.key !== "string" || !MONTH_KEY_RE.test(m.key)) {
      return bad("у месяца некорректный ключ");
    }
    if (typeof m.ready !== "boolean") {
      return bad(`у месяца ${m.key} поле ready не булево`);
    }
    monthKeys.push(m.key);
  }
  if (new Set(monthKeys).size !== monthKeys.length) {
    return bad("месяцы повторяются");
  }

  // Месяцы должны идти подряд и покрывать диапазон целиком.
  const expectedMonths = [];
  {
    const s = parseKey(start);
    const e = parseKey(end);
    let y = s.year;
    let mo = s.month;
    for (let guard = 0; guard < 600; guard++) {
      expectedMonths.push(`${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}`);
      if (y === e.year && mo === e.month) break;
      mo += 1;
      if (mo === 13) { mo = 1; y += 1; }
    }
  }
  if (monthKeys.length !== expectedMonths.length) {
    return bad(`месяцев ${monthKeys.length}, а диапазон требует ${expectedMonths.length}`);
  }
  for (let i = 0; i < expectedMonths.length; i++) {
    if (monthKeys[i] !== expectedMonths[i]) {
      return bad(`ожидался месяц ${expectedMonths[i]}, получен ${monthKeys[i]}`);
    }
  }

  // --- Дни ----------------------------------------------------------------
  if (!isPlainObject(data.days)) return bad("поле days не является объектом");
  const dayKeys = Object.keys(data.days);

  let expectedDays = 0;
  for (const mk of expectedMonths) {
    const [y, mo] = mk.split("-").map(Number);
    expectedDays += daysInMonth(y, mo);
  }
  if (dayKeys.length !== expectedDays) {
    return bad(`дней ${dayKeys.length}, а диапазон требует ${expectedDays}`);
  }

  // Непрерывность: обходим диапазон и требуем каждый день. Заодно ловим
  // обрезанный файл, где хвост просто не доехал.
  for (let key = start; ; key = addDays(key, 1)) {
    const day = data.days[key];
    if (day === undefined) return bad(`пропущен день ${key}`);
    if (!isPlainObject(day) || !isPlainObject(day.cells)) {
      return bad(`у дня ${key} нет ячеек`);
    }

    const cellIds = Object.keys(day.cells);
    if (cellIds.length !== rowIds.size) {
      return bad(`у дня ${key} ячеек ${cellIds.length}, а строк ${rowIds.size}`);
    }
    for (const id of cellIds) {
      if (!rowIds.has(id)) return bad(`день ${key} ссылается на неизвестную строку «${id}»`);
      const cell = day.cells[id];
      if (!isPlainObject(cell)) return bad(`некорректная ячейка ${key}/${id}`);
      if (!COLORS.has(cell.c)) {
        return bad(`недопустимый цвет «${cell.c}» в ${key}/${id}`);
      }
      if (typeof cell.m !== "string") {
        return bad(`отметка в ${key}/${id} не строка`);
      }
    }

    if (key === end) break;
  }

  // Ни один день не должен выходить за диапазон.
  for (const key of dayKeys) {
    if (compare(key, start) < 0 || compare(key, end) > 0) {
      return bad(`день ${key} выходит за диапазон`);
    }
  }

  // --- Фазы луны ----------------------------------------------------------
  if (!Array.isArray(data.moonEvents)) return bad("moonEvents не массив");
  let prev = null;
  for (const ev of data.moonEvents) {
    if (!isPlainObject(ev) || typeof ev.date !== "string") {
      return bad("у события луны нет даты");
    }
    try {
      parseKey(ev.date);
    } catch {
      return bad(`некорректная дата фазы: ${ev.date}`);
    }
    if (!MOON_TYPES.has(ev.type)) {
      return bad(`недопустимый тип фазы «${ev.type}» на ${ev.date}`);
    }
    if (prev && compare(prev.date, ev.date) >= 0) {
      return bad(`фазы луны идут не по возрастанию дат: ${prev.date} → ${ev.date}`);
    }
    prev = ev;
  }

  if (data.moonGaps !== undefined) {
    if (!Array.isArray(data.moonGaps)) return bad("moonGaps не массив");
    for (const gap of data.moonGaps) {
      if (!isPlainObject(gap) || typeof gap.from !== "string" || typeof gap.to !== "string") {
        return bad("некорректный разрыв в moonGaps");
      }
    }
  }

  // --- Легенда ------------------------------------------------------------
  const legend = data.legend;
  if (!isPlainObject(legend) || !Array.isArray(legend.marks) || !Array.isArray(legend.colors)) {
    return bad("легенда неполна");
  }

  return { ok: true };
}

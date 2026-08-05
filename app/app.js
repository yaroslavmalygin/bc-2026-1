/**
 * Бизнес-календарь — логика приложения.
 *
 * Порядок запуска: сначала мгновенно рисуем сохранённую копию, и только
 * потом, параллельно, проверяем сеть. Пустой экран в ожидании зависшего
 * запроса недопустим — быстрый старт и есть причина, по которой всё это
 * делалось.
 */

import * as D from "./dates.js";
import { MoonModel, drawMoon } from "./moon.js";
import { commit, fetchFresh, hasStored, loadStored } from "./store.js";

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

const WINDOW = 3;          // сколько дней вокруг текущего наполняем строками
const VERDICTS = {
  good:    { v: "Отличный день", n: "Усиливается влияние и авторитет, диагностика точна" },
  neutral: { v: "Нейтральный день", n: "Вмешательство не окажет значительного воздействия" },
  bad:     { v: "Крайне неблагоприятный день", n: "Врачебные ошибки, ложные результаты" },
  none:    { v: "Особых указаний нет", n: "В таблице этот день по этой строке не размечен" },
};

const state = {
  data: null,
  moon: null,
  rows: [],
  months: new Map(),
  current: null,
  min: null,
  max: null,
  today: null,          // ключ сегодня, даже если он вне диапазона
  todayInRange: false,
  banners: [],
  cards: new Map(),     // ключ дня → элемент карточки
  order: [],            // ключи дней по порядку
};

const el = (id) => document.getElementById(id);

const dom = {
  app: el("app"),
  barDow: el("barDow"),
  barDay: el("barDay"),
  todayBtn: el("todayBtn"),
  calBtn: el("calBtn"),
  legBtn: el("legBtn"),
  banners: el("banners"),
  moonbar: el("moonbar"),
  moonDisc: el("moonDisc"),
  moonTitle: el("moonTitle"),
  moonSub: el("moonSub"),
  deck: el("deck"),
  prevBtn: el("prevBtn"),
  nextBtn: el("nextBtn"),
  fcBtn: el("fcBtn"),
  fcLabel: el("fcLabel"),
  scrim: el("scrim"),
  curtain: el("curtain"),
  curtainIcon: el("curtainIcon"),
  curtainTitle: el("curtainTitle"),
  curtainText: el("curtainText"),
  curtainBtn: el("curtainBtn"),
};

const sheets = {
  legend: el("sheetLegend"),
  cal: el("sheetCal"),
  forecast: el("sheetForecast"),
  detail: el("sheetDetail"),
};

// ---------------------------------------------------------------------------
// Мелкие помощники разметки
// ---------------------------------------------------------------------------

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(paths, cls) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", cls);
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// Экран состояния
// ---------------------------------------------------------------------------

const CURTAIN_ICONS = {
  offline: ["M2 8.8a16 16 0 0 1 20 0", "M5.5 12.3a11 11 0 0 1 13 0", "M9 15.8a6 6 0 0 1 6 0", "M12 19.5h.01", "M3 3l18 18"],
  broken: ["M12 3v6", "M12 21a9 9 0 1 0-9-9", "M12 13v4", "M12 20h.01"],
  wait: ["M12 3a9 9 0 1 0 9 9", "M12 7v5l3 2"],
};

function showCurtain({ title, text, iconKey, action }) {
  dom.curtainTitle.textContent = title;
  dom.curtainText.textContent = text || "";
  dom.curtainIcon.replaceChildren();
  if (iconKey) dom.curtainIcon.appendChild(icon(CURTAIN_ICONS[iconKey]));
  if (action) {
    dom.curtainBtn.hidden = false;
    dom.curtainBtn.textContent = action.label;
    dom.curtainBtn.onclick = action.onClick;
  } else {
    dom.curtainBtn.hidden = true;
  }
  dom.curtain.hidden = false;
}

function hideCurtain() {
  dom.curtain.hidden = true;
}

// ---------------------------------------------------------------------------
// Плашки
// ---------------------------------------------------------------------------

function setBanner(id, opts) {
  state.banners = state.banners.filter((b) => b.id !== id);
  if (opts) state.banners.push({ id, ...opts });
  renderBanners();
}

function renderBanners() {
  dom.banners.replaceChildren();
  for (const b of state.banners) {
    const row = node("div", `banner banner-${b.kind || "info"}`);
    row.appendChild(node("span", null, b.text));
    if (b.action) {
      const btn = node("button", null, b.action.label);
      btn.type = "button";
      btn.addEventListener("click", b.action.onClick);
      row.appendChild(btn);
    }
    dom.banners.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Колода
// ---------------------------------------------------------------------------

/**
 * Строим все карточки диапазона, но пустыми.
 *
 * Пустые карточки задают геометрию прокрутки, поэтому нативный снап и
 * позиция скролла работают точно. Строки наполняются только в окне вокруг
 * текущего дня: год по восемь строк — это больше трёх тысяч кнопок,
 * и держать их все в DOM незачем.
 */
function buildDeck() {
  dom.deck.replaceChildren();
  state.cards.clear();
  state.order = [];

  const frag = document.createDocumentFragment();
  for (let key = state.min; ; key = D.addDays(key, 1)) {
    const card = node("div", "card");
    card.dataset.day = key;
    frag.appendChild(card);
    state.cards.set(key, card);
    state.order.push(key);
    if (key === state.max) break;
  }
  dom.deck.appendChild(frag);
}

function monthOf(key) {
  return state.months.get(D.monthKey(key));
}

function fillCard(key) {
  const card = state.cards.get(key);
  if (!card || card.dataset.filled === "1") return;
  card.dataset.filled = "1";
  card.replaceChildren();

  const month = monthOf(key);

  // Незаполненный месяц: строки из другого месяца не показываем ни при
  // каких условиях — иначе приложение будет уверенно врать.
  if (month && !month.ready) {
    const box = node("div", "empty-month");
    box.appendChild(icon(["M12 3a9 9 0 1 0 9 9", "M12 8v5", "M12 16.5h.01"]));
    box.appendChild(node("p", null, "Данные на этот месяц ещё не заполнены"));
    card.appendChild(box);
    return;
  }

  const day = state.data.days[key];
  if (!day) return;

  for (const rowDef of state.rows) {
    const cell = day.cells[rowDef.id];
    const btn = node("button", "row");
    btn.type = "button";
    btn.dataset.c = cell.c;
    btn.setAttribute(
      "aria-label",
      `${rowDef.label} — ${VERDICTS[cell.c].v}${cell.m ? `, отметка ${cell.m}` : ""}`,
    );
    btn.appendChild(node("div", "row-label", rowDef.label));

    const chip = node("div", "chip", cell.m || "");
    chip.dataset.c = cell.c;
    btn.appendChild(chip);

    btn.addEventListener("click", () => openDetail(key, rowDef, cell));
    card.appendChild(btn);
  }
}

function clearCard(key) {
  const card = state.cards.get(key);
  if (!card || card.dataset.filled !== "1") return;
  card.dataset.filled = "0";
  card.replaceChildren();
}

function updateWindow(centerKey) {
  const idx = state.order.indexOf(centerKey);
  if (idx < 0) return;
  const from = Math.max(0, idx - WINDOW);
  const to = Math.min(state.order.length - 1, idx + WINDOW);

  const keep = new Set();
  for (let i = from; i <= to; i++) {
    keep.add(state.order[i]);
    fillCard(state.order[i]);
  }
  for (const [key, card] of state.cards) {
    if (card.dataset.filled === "1" && !keep.has(key)) clearCard(key);
  }
}

// ---------------------------------------------------------------------------
// Текущий день
// ---------------------------------------------------------------------------

let settleUntil = 0;

function goTo(key, smooth = false) {
  const target = D.clamp(key, state.min, state.max);
  const card = state.cards.get(target);
  if (!card) return;
  updateWindow(target);

  // Сторож нужен только плавной прокрутке: пока она идёт, обработчик scroll
  // успевал бы отрисовать промежуточные дни, и шапка с луной мигали бы.
  // Мгновенный переход попадает точно с первого раза, и глушить события
  // после него нельзя — иначе свайп сразу после загрузки будет проигнорирован.
  settleUntil = smooth ? Date.now() + 500 : 0;

  dom.deck.scrollTo({ left: card.offsetLeft, behavior: smooth ? "smooth" : "auto" });
  setCurrent(target);
}

function setCurrent(key) {
  state.current = key;
  updateWindow(key);

  dom.barDow.textContent = D.weekdayFull(key);
  dom.barDay.textContent = D.formatLong(key);

  dom.todayBtn.classList.toggle("on", state.todayInRange && key !== state.today);
  dom.prevBtn.disabled = key === state.min;
  dom.nextBtn.disabled = key === state.max;

  const month = monthOf(key);
  dom.fcLabel.textContent = `Прогноз на ${D.monthAccusative(D.monthKey(key))}`;
  dom.fcBtn.disabled = !month || !month.ready || !month.note;

  const info = state.moon.describe(key);
  dom.moonbar.classList.toggle("is-event", info.isEvent);
  dom.moonTitle.textContent = info.title;
  dom.moonSub.textContent = info.subtitle;
  drawMoon(dom.moonDisc, info.illum, 18);
}

// ---------------------------------------------------------------------------
// Шторки
// ---------------------------------------------------------------------------

let openSheetName = null;
let lastFocused = null;

const BACKGROUND = () =>
  [dom.deck, dom.banners, dom.moonbar, document.querySelector(".topbar"),
   document.querySelector(".bottombar")].filter(Boolean);

function focusables(root) {
  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((n) => n.offsetParent !== null);
}

function openSheet(name) {
  if (openSheetName) closeSheets();      // одновременно открытых быть не может
  const sheet = sheets[name];
  if (!sheet) return;

  lastFocused = document.activeElement;
  sheet.hidden = false;
  // Кадр задержки, чтобы сработал переход из состояния transform
  requestAnimationFrame(() => sheet.classList.add("on"));
  dom.scrim.classList.add("on");
  for (const n of BACKGROUND()) n.inert = true;
  openSheetName = name;

  const first = focusables(sheet)[0];
  if (first) first.focus();
}

function closeSheets() {
  for (const [name, sheet] of Object.entries(sheets)) {
    if (!sheet.classList.contains("on") && sheet.hidden) continue;
    sheet.classList.remove("on");
    const finish = () => { sheet.hidden = true; };
    sheet.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 400);           // страховка, если перехода не было
    void name;
  }
  dom.scrim.classList.remove("on");
  for (const n of BACKGROUND()) n.inert = false;
  openSheetName = null;
  if (lastFocused && lastFocused.isConnected) lastFocused.focus();
  lastFocused = null;
}

function trapFocus(event) {
  if (!openSheetName || event.key !== "Tab") return;
  const sheet = sheets[openSheetName];
  const list = focusables(sheet);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ---------------------------------------------------------------------------
// Подробности строки
// ---------------------------------------------------------------------------

function markTexts() {
  const map = new Map();
  for (const m of state.data.legend.marks) map.set(m.char, m.text);
  return map;
}

function openDetail(key, rowDef, cell) {
  const body = el("dtBody");
  el("dtTitle").textContent = rowDef.label;
  body.replaceChildren();

  const head = node("div", "detail-head");
  const chip = node("div", "detail-chip", cell.m || "");
  if (cell.c === "none") {
    chip.style.background = "transparent";
    chip.style.border = "1.5px dashed var(--line)";
    chip.style.color = "var(--ink-3)";
  } else {
    chip.style.background = `var(--${cell.c})`;
    if (cell.c === "neutral") chip.style.color = "#16130A";
  }
  head.appendChild(chip);

  const verdict = node("div", "detail-verdict");
  verdict.appendChild(node("div", "v", VERDICTS[cell.c].v));
  verdict.appendChild(node("div", "n", `${D.formatShort(key)} · ${VERDICTS[cell.c].n}`));
  head.appendChild(verdict);
  body.appendChild(head);

  if (cell.m) {
    const texts = markTexts();
    const list = node("div", "detail-list");
    for (const ch of cell.m) {
      const text = texts.get(ch);
      if (!text) continue;
      const p = node("p");
      p.appendChild(node("b", null, ch));
      p.appendChild(document.createTextNode(` — ${text}`));
      list.appendChild(p);
    }
    if (list.childElementCount) body.appendChild(list);
  }

  openSheet("detail");
}

// ---------------------------------------------------------------------------
// Прогноз
// ---------------------------------------------------------------------------

function openForecast() {
  const mk = D.monthKey(state.current);
  const month = state.months.get(mk);
  if (!month || !month.note) return;
  el("fcTitle").textContent = D.formatMonth(mk);
  el("fcBody").textContent = month.note;
  openSheet("forecast");
}

// ---------------------------------------------------------------------------
// Легенда
// ---------------------------------------------------------------------------

function buildLegend() {
  const body = el("legendBody");
  body.replaceChildren();

  const group = (title, items) => {
    const g = node("div", "leg-group");
    g.appendChild(node("div", "leg-title", title));
    for (const item of items) {
      const row = node("div", "leg-item");
      if (item.swatch !== undefined) {
        const sw = node("div", "swatch");
        sw.dataset.c = item.swatch;
        row.appendChild(sw);
      } else if (item.moon) {
        const box = node("div", "leg-char");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        drawMoon(svg, { value: item.moon === "full" ? 1 : 0.02, waxing: true }, 18);
        box.appendChild(svg);
        row.appendChild(box);
      } else {
        row.appendChild(node("div", "leg-char", item.char));
      }
      const p = node("p");
      p.appendChild(node("b", null, item.lead));
      p.appendChild(document.createTextNode(` — ${item.text}`));
      row.appendChild(p);
      g.appendChild(row);
    }
    return g;
  };

  const colorNames = { good: "Зелёный", neutral: "Жёлтый", bad: "Красный" };
  body.appendChild(group("Цвет строки", [
    ...state.data.legend.colors.map((c) => ({
      swatch: c.key, lead: colorNames[c.key] || c.key, text: c.text,
    })),
    { swatch: "none", lead: "Без заливки", text: "Особых указаний на этот день нет." },
  ]));

  body.appendChild(group("Луна", (state.data.legend.moon || []).map((m) => ({
    moon: m.key, lead: m.key === "full" ? "Полнолуние" : "Новолуние",
    text: m.key === "full"
      ? "Приложение предупреждает за три дня, за два, за день и отмечает сам день."
      : "Так же, с анонсом за три дня.",
  }))));

  const marks = state.data.legend.marks;
  const pick = (chars) => marks.filter((m) => chars.includes(m.char))
    .map((m) => ({ char: m.char, lead: m.char, text: m.text }));

  body.appendChild(group("Дела и деньги", pick(["О", "У", "К", "Х"])));
  body.appendChild(group("Стрижка", pick(["Г", "Р", "Ф", "+"])));
  body.appendChild(group("Тело", pick(["Т", "В", "у"])));

  // Актуальность данных: пользователь должен видеть, чем он пользуется
  const meta = node("div", "meta-block");
  const gen = state.data.generatedAt;
  meta.appendChild(node("div", null, `Данные обновлены: ${D.formatLong(gen)}`));
  meta.appendChild(node("div", null,
    `Календарь действует до: ${D.formatLong(state.data.range.end)}`));
  if (state.data.provisional) {
    meta.appendChild(node("div", null,
      "Цвета предварительные: они ещё не сверены с исходной таблицей."));
  }
  body.appendChild(meta);
}

// ---------------------------------------------------------------------------
// Выбор даты
// ---------------------------------------------------------------------------

let calMonth = null;

function buildCalendar() {
  const grid = el("calGrid");
  grid.replaceChildren();
  el("calMonth").textContent = D.formatMonth(calMonth);

  const minMonth = D.monthKey(state.min);
  const maxMonth = D.monthKey(state.max);
  el("calPrev").disabled = calMonth <= minMonth;
  el("calNext").disabled = calMonth >= maxMonth;

  for (let i = 0; i < 7; i++) {
    const cell = node("div", `cal-dow${i >= 5 ? " we" : ""}`, D.NAMES.WEEKDAY_SHORT[i]);
    grid.appendChild(cell);
  }

  const { year, month } = D.parseMonthKey(calMonth);
  const firstKey = D.firstDayOfMonth(calMonth);
  const lead = D.weekdayIndex(firstKey);
  for (let i = 0; i < lead; i++) grid.appendChild(node("div", "cal-cell empty"));

  const total = D.daysInMonth(year, month);
  const monthInfo = state.months.get(calMonth);

  for (let day = 1; day <= total; day++) {
    const key = D.makeKey(year, month, day);
    const btn = node("button", "cal-cell");
    btn.type = "button";
    if (D.isWeekend(key)) btn.classList.add("we");
    if (key === state.today) btn.classList.add("today");
    if (key === state.current) btn.classList.add("sel");
    if (!D.isBetween(key, state.min, state.max)) btn.classList.add("out");
    else if (monthInfo && !monthInfo.ready) btn.classList.add("not-ready");

    btn.appendChild(node("span", null, String(day)));

    const event = state.moon.eventOn(key);
    if (event) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cal-moon");
      drawMoon(svg, { value: event.type === "full" ? 1 : 0.02, waxing: true }, 18);
      btn.appendChild(svg);
    }

    btn.setAttribute("aria-label",
      `${D.formatLong(key)}${event ? (event.type === "full" ? ", полнолуние" : ", новолуние") : ""}` +
      `${monthInfo && !monthInfo.ready ? ", данные не заполнены" : ""}`);

    btn.addEventListener("click", () => {
      closeSheets();
      goTo(key, false);
    });
    grid.appendChild(btn);
  }
}

function openCalendar() {
  calMonth = D.monthKey(state.current);
  buildCalendar();
  openSheet("cal");
}

// ---------------------------------------------------------------------------
// Перетаскивание мышью
// ---------------------------------------------------------------------------

function setupDrag() {
  let drag = null;
  const THRESHOLD = 6;
  const FLICK = 40;

  dom.deck.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, left: dom.deck.scrollLeft, moved: false };
  });

  dom.deck.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < THRESHOLD) return;
      drag.moved = true;
      dom.deck.classList.add("dragging");
      dom.deck.setPointerCapture(e.pointerId);
    }
    dom.deck.scrollLeft = drag.left - dx;
  });

  const end = (e) => {
    if (!drag) return;
    const { moved, x } = drag;
    const dx = e.clientX - x;
    drag = null;
    if (!moved) return;

    dom.deck.classList.remove("dragging");
    if (dom.deck.hasPointerCapture?.(e.pointerId)) {
      dom.deck.releasePointerCapture(e.pointerId);
    }

    const width = dom.deck.clientWidth;
    const target = Math.abs(dx) > FLICK && Math.abs(dx) < width / 2
      ? D.addDays(state.current, dx < 0 ? 1 : -1)
      : state.order[Math.round(dom.deck.scrollLeft / width)] || state.current;
    goTo(target, true);
  };

  dom.deck.addEventListener("pointerup", end);
  dom.deck.addEventListener("pointercancel", end);
}

// ---------------------------------------------------------------------------
// Раскладка
// ---------------------------------------------------------------------------

/**
 * Проверяем, помещаются ли восемь строк по-человечески.
 *
 * Если нет (маленький экран, крупный системный шрифт, Display Zoom),
 * информация не обрезается: включается компактный режим со внутренним
 * скроллом только у области строк.
 */
function updateCramped() {
  const available = dom.deck.clientHeight;
  const needed = state.rows.length * 44 + (state.rows.length - 1) * 3;
  dom.app.classList.toggle("cramped", available > 0 && available < needed);
}

// ---------------------------------------------------------------------------
// Крайние случаи и плашки
// ---------------------------------------------------------------------------

function refreshTodayState() {
  state.today = D.todayKey();
  state.todayInRange = D.isBetween(state.today, state.min, state.max);

  if (!state.todayInRange) {
    const before = D.compare(state.today, state.min) < 0;
    setBanner("range", {
      kind: "warn",
      text: before
        ? `Календарь начинается ${D.formatLong(state.min)}`
        : `Календарь закончился ${D.formatLong(state.max)} — пора обновить данные`,
    });
  } else {
    setBanner("range", null);
    const left = D.diffDays(state.today, state.max);
    if (left <= 30) {
      setBanner("range", {
        kind: "warn",
        text: `Данных осталось на ${D.pluralDays(left)} — пора обновить календарь`,
      });
    }
  }

  dom.todayBtn.classList.toggle(
    "on", state.todayInRange && state.current !== state.today,
  );
}

function applyData(data, { announce = false } = {}) {
  state.data = data;
  state.rows = data.rows;
  state.months = new Map(data.months.map((m) => [m.key, m]));
  state.moon = new MoonModel(data.moonEvents, data.moonGaps || []);
  state.min = data.range.start;
  state.max = data.range.end;

  refreshTodayState();

  const startAt = D.clamp(state.today, state.min, state.max);
  buildDeck();
  buildLegend();
  goTo(startAt, false);
  updateCramped();

  setBanner("provisional", data.provisional
    ? { kind: "info", text: "Предварительные данные: цвета ещё не сверены с таблицей" }
    : null);

  if (announce) {
    setBanner("updated", { kind: "info", text: "Данные обновлены" });
    setTimeout(() => setBanner("updated", null), 6000);
  }

  hideCurtain();
}

// ---------------------------------------------------------------------------
// Загрузка
// ---------------------------------------------------------------------------

async function boot() {
  showCurtain({ title: "Загрузка", text: "Открываем календарь", iconKey: "wait" });

  const stored = await loadStored();
  if (stored) applyData(stored);

  const fresh = await fetchFresh();

  if (fresh.ok) {
    // Меняем данные, только если версия действительно другая: иначе
    // «Данные обновлены» всплывало бы при каждом запуске.
    const changed = !stored || stored.dataHash !== fresh.data.dataHash;
    await commit(fresh.data);
    if (changed) applyData(fresh.data, { announce: Boolean(stored) });
    setBanner("fetch", null);
    return;
  }

  // Свежие данные не приехали. Если есть рабочая копия — просто говорим
  // об этом ненавязчиво и продолжаем на ней.
  console.warn(`обновление не удалось (${fresh.kind}): ${fresh.reason}`);

  if (stored) {
    if (fresh.kind === "invalid" || fresh.kind === "corrupt") {
      setBanner("fetch", {
        kind: "error",
        text: "Получены повреждённые данные — показываем последнюю рабочую версию",
      });
    }
    return;
  }

  // Рабочей копии нет вообще — это первый запуск, и показать нечего.
  const offline = fresh.kind === "offline" || fresh.kind === "timeout";
  showCurtain({
    title: offline ? "Нет интернета" : "Данные повреждены",
    text: offline
      ? "Календарь ещё ни разу не загружался, поэтому офлайн показать нечего. Подключитесь к сети и откройте приложение снова."
      : `Файл календаря не удалось прочитать: ${fresh.reason}`,
    iconKey: offline ? "offline" : "broken",
    action: { label: "Попробовать снова", onClick: () => boot() },
  });
}

// ---------------------------------------------------------------------------
// События
// ---------------------------------------------------------------------------

function setupEvents() {
  dom.prevBtn.addEventListener("click", () => goTo(D.addDays(state.current, -1), true));
  dom.nextBtn.addEventListener("click", () => goTo(D.addDays(state.current, 1), true));
  dom.todayBtn.addEventListener("click", () => goTo(state.today, true));
  dom.legBtn.addEventListener("click", () => openSheet("legend"));
  dom.calBtn.addEventListener("click", openCalendar);
  dom.fcBtn.addEventListener("click", openForecast);

  el("calPrev").addEventListener("click", () => {
    calMonth = D.addMonths(calMonth, -1);
    buildCalendar();
  });
  el("calNext").addEventListener("click", () => {
    calMonth = D.addMonths(calMonth, 1);
    buildCalendar();
  });

  dom.scrim.addEventListener("click", closeSheets);
  for (const btn of document.querySelectorAll("[data-close]")) {
    btn.addEventListener("click", closeSheets);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSheets(); return; }
    trapFocus(e);
    if (openSheetName || !state.current) return;
    if (e.key === "ArrowRight") goTo(D.addDays(state.current, 1), true);
    else if (e.key === "ArrowLeft") goTo(D.addDays(state.current, -1), true);
  });

  let scrollTimer = null;
  dom.deck.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (Date.now() < settleUntil) return;
      const idx = Math.round(dom.deck.scrollLeft / dom.deck.clientWidth);
      const key = state.order[Math.max(0, Math.min(state.order.length - 1, idx))];
      if (key && key !== state.current) setCurrent(key);
    }, 70);
  }, { passive: true });

  setupDrag();

  // Viewport меняется из-за адресной строки, safe area и системного
  // интерфейса даже в фиксированном portrait. Держим карточку на месте.
  let resizeTimer = null;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.current) return;
      updateCramped();
      goTo(state.current, false);
    }, 120);
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  // Установленное приложение живёт в памяти сутками: вернулись утром —
  // «сегодня» обязано стать сегодняшним.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !state.data) return;
    const fresh = D.todayKey();
    if (fresh === state.today) return;
    refreshTodayState();
    if (state.current === D.clamp(state.today, state.min, state.max)) return;
    goTo(D.clamp(fresh, state.min, state.max), false);
  });
}

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Был ли воркер до нас. Первая установка тоже поднимает controllerchange
  // (из-за clients.claim), но обновляться там ещё не с чего — предлагать
  // «новую версию» на самом первом запуске бессмысленно.
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.register("./sw.js").catch((err) => {
    console.warn("service worker не зарегистрирован:", err);
  });

  // Внезапная перезагрузка посреди свайпа или чтения прогноза недопустима,
  // поэтому обновление оболочки предлагается кнопкой.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    setBanner("sw", {
      kind: "info",
      text: "Доступна новая версия",
      action: {
        label: "Перезапустить",
        onClick: () => { reloading = true; location.reload(); },
      },
    });
  });
}

// ---------------------------------------------------------------------------

setupEvents();
setupServiceWorker();
boot();

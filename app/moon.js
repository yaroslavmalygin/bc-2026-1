/**
 * Фаза луны: расчёт освещённости и отрисовка диска.
 *
 * Освещённость здесь — визуальная иллюстрация, а не астрономия. Опорные точки
 * берутся из разметки астролога, между ними идёт простая интерполяция: так
 * картинка всегда сходится с таблицей и не спорит с ней.
 *
 * Но выдумывать фазу нельзя. Если опорной точки с какой-то стороны нет или
 * между соседними событиями зияет разрыв, неизвестно не только значение, но и
 * направление: за сорок дней луна успевает и вырасти, и убыть, и снова
 * вырасти. В таких местах показывается нейтральный диск и «Нет данных о фазе».
 */

import { addDays, compare, diffDays, pluralDays } from "./dates.js";

const ANNOUNCE_DAYS = 3;

export class MoonModel {
  constructor(events = [], gaps = []) {
    this.events = [...events].sort((a, b) => compare(a.date, b.date));
    this.gaps = gaps || [];
    this.byDate = new Map(this.events.map((e) => [e.date, e.type]));
  }

  /** Событие ровно в этот день, либо null. */
  eventOn(key) {
    const type = this.byDate.get(key);
    return type ? { date: key, type } : null;
  }

  /** Ближайшее событие вперёд не далее чем через ANNOUNCE_DAYS суток. */
  upcoming(key) {
    for (let i = 1; i <= ANNOUNCE_DAYS; i++) {
      const probe = addDays(key, i);
      const type = this.byDate.get(probe);
      if (type) return { date: probe, type, inDays: i };
    }
    return null;
  }

  /** Попадает ли день в размеченный разрыв. */
  inGap(key) {
    return this.gaps.some(
      (g) => compare(key, g.from) > 0 && compare(key, g.to) < 0,
    );
  }

  /** Соседние опорные события вокруг дня. */
  bracket(key) {
    let before = null;
    let after = null;
    for (const ev of this.events) {
      const cmp = compare(ev.date, key);
      if (cmp <= 0) before = ev;
      if (cmp >= 0) { after = ev; break; }
    }
    return { before, after };
  }

  /**
   * Освещённость 0..1 и направление, либо null, если данных не хватает.
   *
   * null возвращается на краях диапазона (нет опоры с одной стороны) и внутри
   * разрывов. Экстраполировать за пределы известных событий запрещено.
   */
  illumination(key) {
    if (this.inGap(key)) return null;

    const exact = this.byDate.get(key);
    if (exact) {
      return { value: exact === "full" ? 1 : 0, waxing: exact === "new", exact: true };
    }

    const { before, after } = this.bracket(key);
    if (!before || !after) return null;

    const span = diffDays(before.date, after.date);
    if (span <= 0) return null;

    const passed = diffDays(before.date, key);
    const t = passed / span;

    // Плавный переход косинусом: у опорных точек производная нулевая,
    // поэтому диск не «дёргается» рядом с новолунием и полнолунием.
    const eased = (1 - Math.cos(Math.PI * t)) / 2;
    const waxing = before.type === "new";
    const value = waxing ? eased : 1 - eased;

    return { value, waxing, exact: false };
  }

  /** Всё, что нужно лунной полосе для одного дня. */
  describe(key) {
    const illum = this.illumination(key);
    const percent = illum ? Math.round(illum.value * 100) : null;
    const litText = percent === null ? "Нет данных о фазе" : `Освещённость ${percent}%`;

    const today = this.eventOn(key);
    if (today) {
      return {
        title: today.type === "full" ? "Полнолуние сегодня" : "Новолуние сегодня",
        subtitle: litText,
        illum,
        isEvent: true,
      };
    }

    const soon = this.upcoming(key);
    if (soon) {
      const name = soon.type === "full" ? "полнолуние" : "новолуние";
      const title =
        soon.inDays === 1 ? `Завтра ${name}` : `Через ${pluralDays(soon.inDays)} ${name}`;
      return { title, subtitle: litText, illum, isEvent: false };
    }

    if (!illum) {
      return {
        title: "Фаза неизвестна",
        subtitle: "На этом отрезке фазы не размечены",
        illum: null,
        isEvent: false,
      };
    }

    return {
      title: illum.waxing ? "Растущая луна" : "Убывающая луна",
      subtitle: litText,
      illum,
      isEvent: false,
    };
  }
}

/**
 * Путь освещённой части диска.
 *
 * Две дуги: внешняя полуокружность плюс эллипс-терминатор, у которого
 * горизонтальная полуось равна r·|1−2k|. При k = 0.5 она вырождается в
 * прямую и получается ровно половина диска.
 */
export function litPath(r, k, waxing) {
  const rx = r * Math.abs(1 - 2 * k);
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = k < 0.5 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  return (
    `M 0 ${-r}` +
    ` A ${r} ${r} 0 0 ${outerSweep} 0 ${r}` +
    ` A ${rx} ${r} 0 0 ${innerSweep} 0 ${-r} Z`
  );
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * Рисует диск в переданный <svg>.
 *
 * illum === null — нейтральный вид: контур без заливки. Именно он означает
 * «фаза неизвестна», и спутать его с новолунием нельзя, потому что новолуние
 * рисуется сплошным тёмным кругом.
 */
export function drawMoon(svg, illum, r = 18) {
  svg.setAttribute("viewBox", `${-r - 2} ${-r - 2} ${(r + 2) * 2} ${(r + 2) * 2}`);
  svg.replaceChildren();

  if (!illum) {
    svg.appendChild(el("circle", {
      cx: 0, cy: 0, r,
      fill: "none",
      stroke: "var(--ink-3)",
      "stroke-width": 1.5,
      "stroke-dasharray": "3 3",
    }));
    return;
  }

  svg.appendChild(el("circle", { cx: 0, cy: 0, r, fill: "var(--moon-dark)" }));

  const k = Math.min(1, Math.max(0, illum.value));
  if (k > 0.002) {
    svg.appendChild(el("path", { d: litPath(r, k, illum.waxing), fill: "var(--moon-lit)" }));
  }

  svg.appendChild(el("circle", {
    cx: 0, cy: 0, r,
    fill: "none",
    stroke: "var(--line)",
    "stroke-width": 1,
  }));
}

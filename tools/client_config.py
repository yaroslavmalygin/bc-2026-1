"""
Конфиг клиента: то, что различается от заказчика к заказчику.

Диапазон и набор строк раньше были константами конвертера. Клиентов стало
больше одного, и они различаются: год считается не всегда с августа, а
кому-то вместо массажа нужна пластика. Всё остальное — палитры, раскладка
блока, каталог символов — свойство астролога, а не клиента, и осталось в
calendar_config.py.

EXPECTED_MONTHS и EXPECTED_DAYS здесь ВЫЧИСЛЯЮТСЯ из диапазона, а не
задаются рядом с ним. Тремя независимыми константами их легко
рассогласовать, и рассогласование выглядело бы как рабочий календарь.
"""

import calendar as pycal
import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import calendar_config as cfg


class ClientConfigError(Exception):
    """Конфиг клиента непригоден. Сообщение говорит, что править."""


def _parse_day(value, field_name):
    if not isinstance(value, str):
        raise ClientConfigError(f"{field_name} должен быть строкой YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ClientConfigError(f"{field_name}: {exc}") from exc


MOON_TYPES = ("new", "full")


@dataclass
class ClientConfig:
    range_start: str
    range_end: str
    rows: list
    extra_marks: dict = field(default_factory=dict)
    moon_anchors: dict = field(default_factory=dict)

    @property
    def moon_anchor_before(self):
        return self.moon_anchors.get("before")

    @property
    def moon_anchor_after(self):
        return self.moon_anchors.get("after")

    @property
    def row_ids(self):
        return [r["id"] for r in self.rows]

    @property
    def activity_row_count(self):
        return len(self.rows)

    @property
    def start_date(self):
        return date.fromisoformat(self.range_start)

    @property
    def end_date(self):
        return date.fromisoformat(self.range_end)

    @property
    def expected_months(self):
        s, e = self.start_date, self.end_date
        return (e.year - s.year) * 12 + (e.month - s.month) + 1

    @property
    def expected_days(self):
        return (self.end_date - self.start_date).days + 1

    @property
    def known_marks(self):
        """Каталог астролога плюс буквы, объявленные этим клиентом."""
        return list(cfg.KNOWN_MARKS) + list(self.extra_marks.keys())

    @property
    def mark_texts(self):
        merged = dict(cfg.MARK_TEXTS_FALLBACK)
        merged.update(self.extra_marks)
        return merged

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise ClientConfigError("конфиг клиента не является объектом")

        rng = data.get("range")
        if not isinstance(rng, dict):
            raise ClientConfigError("нет объекта range с полями start и end")

        start = _parse_day(rng.get("start"), "range.start")
        end = _parse_day(rng.get("end"), "range.end")

        if start >= end:
            raise ClientConfigError(
                f"range.start ({start}) не раньше range.end ({end})")

        # Календарь состоит из блоков месяцев целиком: половина месяца
        # означала бы блок, часть которого не с чем сверить.
        if start.day != 1:
            raise ClientConfigError(
                f"range.start должен быть первое число месяца, а это {start}")
        last = pycal.monthrange(end.year, end.month)[1]
        if end.day != last:
            raise ClientConfigError(
                f"range.end должен быть последний день месяца "
                f"({end.year}-{end.month:02d}-{last}), а это {end}")

        rows = data.get("rows")
        if not isinstance(rows, list) or not rows:
            raise ClientConfigError("список строк rows пуст или отсутствует")

        seen = set()
        for i, row in enumerate(rows, 1):
            if not isinstance(row, dict):
                raise ClientConfigError(f"строка {i} не является объектом")
            for key in ("id", "label", "short"):
                value = row.get(key)
                if not isinstance(value, str) or not value:
                    raise ClientConfigError(
                        f"у строки {i} нет непустого поля {key}")
            if row["id"] in seen:
                raise ClientConfigError(
                    f"идентификатор строки «{row['id']}» повторяется")
            seen.add(row["id"])

        extra = data.get("extraMarks", {})
        if not isinstance(extra, dict):
            raise ClientConfigError("extraMarks должен быть объектом")
        for mark, text in extra.items():
            if len(mark) != 1:
                raise ClientConfigError(
                    f"символ «{mark}» должен быть длиной в один знак")
            if mark in cfg.KNOWN_MARKS:
                raise ClientConfigError(
                    f"символ «{mark}» уже есть в каталоге, "
                    "переопределять его в конфиге клиента нельзя")
            if not isinstance(text, str) or not text:
                raise ClientConfigError(f"у символа «{mark}» пустая расшифровка")

        anchors = _parse_moon_anchors(data.get("moonAnchors", {}), start, end)

        return cls(
            range_start=rng["start"],
            range_end=rng["end"],
            rows=[dict(r) for r in rows],
            extra_marks=dict(extra),
            moon_anchors=anchors,
        )


def _parse_moon_anchors(data, start, end):
    """Фазы луны, ближайшие снаружи диапазона.

    Без них крайние дни календаря остаются без фазы: интерполяция требует
    опоры с обеих сторон, а таблица астролога заканчивается вместе с
    диапазоном. Экстраполировать нельзя — за месяц луна успевает и вырасти,
    и убыть, поэтому неизвестно даже направление. Значит опоры приходят
    данными: астролог называет две даты.

    Здесь проверяется только форма и сторона. Что опора не спорит с
    таблицей — чередование типов и расстояние до ближайшей фазы — проверяет
    конвертер: конфиг о содержимом книги ничего не знает.
    """
    if not isinstance(data, dict):
        raise ClientConfigError("moonAnchors должен быть объектом")

    unknown = set(data) - {"before", "after"}
    if unknown:
        raise ClientConfigError(
            f"в moonAnchors посторонние ключи: {', '.join(sorted(unknown))}. "
            "Допустимы только before и after.")

    out = {}
    for side in ("before", "after"):
        raw = data.get(side)
        if raw is None:
            continue
        if not isinstance(raw, dict):
            raise ClientConfigError(f"moonAnchors.{side} должен быть объектом")

        when = _parse_day(raw.get("date"), f"moonAnchors.{side}.date")
        kind = raw.get("type")
        if kind not in MOON_TYPES:
            raise ClientConfigError(
                f"moonAnchors.{side}.type — «{kind}», а допустимы "
                f"только {' или '.join(MOON_TYPES)}")

        if side == "before" and when >= start:
            raise ClientConfigError(
                f"moonAnchors.before ({when}) должна быть раньше начала "
                f"диапазона ({start}): опора внутри диапазона уже есть "
                "в самой таблице")
        if side == "after" and when <= end:
            raise ClientConfigError(
                f"moonAnchors.after ({when}) должна быть позже конца "
                f"диапазона ({end}): опора внутри диапазона уже есть "
                "в самой таблице")

        out[side] = {"date": when.isoformat(), "type": kind}
    return out


def load_client(path):
    path = Path(path)
    if not path.exists():
        raise ClientConfigError(f"конфиг клиента не найден: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ClientConfigError(f"{path.name} не разбирается как JSON: {exc}") from exc
    try:
        return ClientConfig.from_dict(data)
    except ClientConfigError as exc:
        raise ClientConfigError(f"{path.name}: {exc}") from exc

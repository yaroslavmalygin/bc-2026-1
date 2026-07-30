# Мультиклиентские сборки календаря — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завести календарь любому новому клиенту астролога отдельной ссылкой `…github.io/bc/NN/` одной командой, без копирования проекта и без правки кода.

**Architecture:** `app/` — исходник оболочки, `clients/NN/client.json` — что различается у клиента (диапазон, строки, доп. символы), `docs/NN/` — сгенерированная публикуемая сборка. Идентификатор клиента выводится из адреса скрипта и разводит IndexedDB и Cache Storage, которые делятся по origin, а не по пути.

**Tech Stack:** Python 3.12 + openpyxl (конвертер), статический ES-модульный фронтенд без сборки, Playwright (браузерные тесты), GitHub Pages.

## Global Constraints

- Никаких новых зависимостей в рантайме: приложение остаётся статикой без сборки.
- Комментарии и текст интерфейса — по-русски; комментарий объясняет **почему**, а не пересказывает код.
- Даты — только через `app/dates.js`. Запрещены `new Date("YYYY-MM-DD")`, `toISOString()` для ключа дня, `+ 86400000`.
- `calendar.json` не проходит через service worker. Порядок в `store.js` неизменен: получить → распарсить → провалидировать → previous = current → current = new.
- Конвертер обязан падать, а не догадываться. Сообщение называет месяц и ячейку.
- Спека: `specs/2026-07-30-multiclient-design.md`.
- Планы и спеки лежат в `plans/` и `specs/` в корне, **не** в `docs/` — `docs/` публикуется GitHub Pages.
- Диапазон клиента всегда покрывает целые месяцы: начало — первое число, конец — последний день месяца.
- Тесты гоняются все: `python tests/test_converter.py`, `node tests/test_dates.mjs --all-zones`, `node tests/test_app.mjs`, `node tests/test_clients.mjs`.

## File Structure

| Файл | Ответственность |
|---|---|
| `tools/client_config.py` | создать — чтение и проверка `client.json`, вычисление ожидаемых месяцев и дней |
| `tools/calendar_config.py` | изменить — убрать `RANGE_*`, `EXPECTED_*`, `ROW_DEFS`, `ACTIVITY_ROW_COUNT`; добавить `SITE_BASE` |
| `tools/make_reference_xlsx.py` | изменить — строит книгу по `ClientConfig` |
| `tools/xlsx_to_calendar_json.py` | изменить — принимает `ClientConfig`, аргумент `--client` |
| `tools/build_client.py` | создать — `app/` → `docs/NN/`, манифест с `id`, данные не трогает |
| `app/client-id.js` | создать — вывод идентификатора клиента из адреса модуля |
| `app/store.js` | изменить — `DB_NAME` с идентификатором |
| `app/sw.js` | изменить — префикс кэша с идентификатором, чистка по своему префиксу, поиск в своём кэше |
| `app/manifest.webmanifest` | изменить — `id` убирается из исходника, пишется генератором |
| `clients/01/client.json` | создать — первый клиент |
| `tests/fixtures/client-test.json` | создать — фикстура для тестов |
| `tests/test_client_config.py` | создать — проверки конфига |
| `tests/test_clients.mjs` | создать — изоляция двух клиентов в браузере |
| `workflows/add_client.md` | создать — SOP «заводим клиента» |

---

### Task 1: `tools/client_config.py` — конфиг клиента

**Files:**
- Create: `tools/client_config.py`
- Create: `tests/test_client_config.py`

**Interfaces:**
- Consumes: ничего.
- Produces: класс `ClientConfig` с полями `range_start: str`, `range_end: str`, `rows: list[dict]`, `extra_marks: dict[str, str]`; свойствами `row_ids: list[str]`, `activity_row_count: int`, `expected_months: int`, `expected_days: int`; функцией `load_client(path: Path) -> ClientConfig` и исключением `ClientConfigError`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/test_client_config.py`:

```python
"""
Проверка конфига клиента.

Конфиг описывает то, что различается у клиентов: диапазон, строки, доп.
символы. Ошибка здесь тише всех остальных — неверный диапазон даст
внешне правдоподобный календарь не на тот год.

Запуск:  python tests/test_client_config.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from client_config import ClientConfig, ClientConfigError, load_client
from console import BOLD, RESET, fail, head, info, ok

WORK = ROOT / ".tmp" / "fixtures"

GOOD = {
    "range": {"start": "2026-09-01", "end": "2027-09-30"},
    "rows": [
        {"id": "negotiations", "label": "Важные переговоры", "short": "Переговоры"},
        {"id": "finance", "label": "Финансы", "short": "Финансы"},
    ],
    "extraMarks": {},
}


def cfg(**over):
    data = json.loads(json.dumps(GOOD))
    data.update(over)
    return data


CASES = []


def case(name):
    def deco(fn):
        CASES.append((name, fn))
        return fn
    return deco


@case("диапазон из 13 месяцев даёт 395 дней")
def _():
    c = ClientConfig.from_dict(cfg())
    assert c.expected_months == 13, c.expected_months
    # сен26(30)+окт(31)+ноя(30)+дек(31)+янв27(31)+фев(28)+мар(31)+апр(30)
    # +май(31)+июн(30)+июл(31)+авг(31)+сен(30) = 395
    assert c.expected_days == 395, c.expected_days


@case("количество строк берётся из конфига")
def _():
    c = ClientConfig.from_dict(cfg())
    assert c.activity_row_count == 2, c.activity_row_count
    assert c.row_ids == ["negotiations", "finance"], c.row_ids


@case("начало не с первого числа — ошибка")
def _():
    bad = cfg(range={"start": "2026-09-15", "end": "2027-09-30"})
    expect_error(bad, "первое число")


@case("конец не последним днём месяца — ошибка")
def _():
    bad = cfg(range={"start": "2026-09-01", "end": "2027-09-15"})
    expect_error(bad, "последний день")


@case("конец раньше начала — ошибка")
def _():
    bad = cfg(range={"start": "2027-09-01", "end": "2026-09-30"})
    expect_error(bad, "раньше")


@case("пустой список строк — ошибка")
def _():
    expect_error(cfg(rows=[]), "строк")


@case("повторяющийся id строки — ошибка")
def _():
    rows = [
        {"id": "finance", "label": "Финансы", "short": "Финансы"},
        {"id": "finance", "label": "Другое", "short": "Другое"},
    ]
    expect_error(cfg(rows=rows), "повторяется")


@case("строка без подписи — ошибка")
def _():
    rows = [{"id": "finance", "short": "Финансы"}]
    expect_error(cfg(rows=rows), "label")


@case("доп. символ длиннее одного знака — ошибка")
def _():
    expect_error(cfg(extraMarks={"ПП": "текст"}), "один знак")


@case("доп. символ, уже занятый каталогом — ошибка")
def _():
    expect_error(cfg(extraMarks={"О": "другой смысл"}), "уже есть в каталоге")


def expect_error(data, fragment):
    try:
        ClientConfig.from_dict(data)
    except ClientConfigError as exc:
        assert fragment in str(exc), f"сообщение «{exc}» не содержит «{fragment}»"
        return
    raise AssertionError(f"ожидалась ошибка со словом «{fragment}», но её не было")


@case("load_client читает файл")
def _():
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "client-ok.json"
    path.write_text(json.dumps(GOOD, ensure_ascii=False), encoding="utf-8")
    c = load_client(path)
    assert c.expected_months == 13


@case("load_client на битом JSON называет файл")
def _():
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "client-broken.json"
    path.write_text("{ это не json", encoding="utf-8")
    try:
        load_client(path)
    except ClientConfigError as exc:
        assert "client-broken.json" in str(exc), exc
        return
    raise AssertionError("ожидалась ошибка разбора")


def main():
    head("Конфиг клиента")
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            ok(name)
        except AssertionError as exc:
            fail(f"{name}: {exc}")
            failed += 1
    head("Итог")
    info(f"{BOLD}{len(CASES) - failed}/{len(CASES)}{RESET} проверок прошло")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python tests/test_client_config.py`
Expected: `ModuleNotFoundError: No module named 'client_config'`

- [ ] **Step 3: Написать реализацию**

Создать `tools/client_config.py`:

```python
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


@dataclass
class ClientConfig:
    range_start: str
    range_end: str
    rows: list
    extra_marks: dict = field(default_factory=dict)

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

        return cls(
            range_start=rng["start"],
            range_end=rng["end"],
            rows=[dict(r) for r in rows],
            extra_marks=dict(extra),
        )


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
```

- [ ] **Step 4: Прогнать тест**

Run: `python tests/test_client_config.py`
Expected: `12/12 проверок прошло`, код возврата 0

- [ ] **Step 5: Коммит**

```bash
git add tools/client_config.py tests/test_client_config.py
git commit -m "Конфиг клиента: диапазон, строки, доп. символы"
```

---

### Task 2: Эталонная книга строится по конфигу

**Files:**
- Create: `tests/fixtures/client-test.json`
- Modify: `tools/make_reference_xlsx.py` — `build()` и всё, что читает `cfg.ROW_DEFS` (строки 201, 281, 295) и `cfg.RANGE_START` / `RANGE_END` / `EXPECTED_MONTHS` (строки 321-322, 353)

**Interfaces:**
- Consumes: `ClientConfig`, `load_client` из Task 1.
- Produces: `build(path, client, mode="demo")` — сигнатура пополняется вторым позиционным параметром `client: ClientConfig`. CLI получает `--client PATH` со значением по умолчанию `tests/fixtures/client-test.json`.

- [ ] **Step 1: Создать фикстуру**

Создать `tests/fixtures/client-test.json` — те же восемь строк и тот же диапазон, что были константами, чтобы существующие 16 проверок конвертера сохранили смысл:

```json
{
  "range": { "start": "2026-08-01", "end": "2027-08-31" },
  "rows": [
    { "id": "negotiations", "label": "Важные переговоры и выступления", "short": "Переговоры" },
    { "id": "finance", "label": "Финансы, перечисления, инвестиции", "short": "Финансы" },
    { "id": "audit", "label": "Аудит, отчёты", "short": "Аудит" },
    { "id": "launch", "label": "Запуск нового продукта", "short": "Запуск" },
    { "id": "haircut", "label": "Стрижка", "short": "Стрижка" },
    { "id": "teeth", "label": "Зубы: лечение, удаление", "short": "Зубы" },
    { "id": "medical", "label": "Мед. обследование", "short": "Обследование" },
    { "id": "massage", "label": "Массаж", "short": "Массаж" }
  ],
  "extraMarks": {}
}
```

- [ ] **Step 2: Написать падающий тест**

Дописать в `tests/test_client_config.py` перед `def main()`:

```python
@case("эталонная книга строится по конфигу и даёт нужное число блоков")
def _():
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tools"))
    from make_reference_xlsx import build
    from openpyxl import load_workbook

    client = load_client(ROOT / "tests" / "fixtures" / "client-test.json")
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "ref-from-config.xlsx"
    build(path, client, mode="demo")

    wb = load_workbook(path)
    ws = wb[cfg_mod.CALENDAR_SHEET_CANDIDATES[0]]
    titles = 0
    for r in range(1, ws.max_row + 1):
        value = str(ws.cell(row=r, column=cfg_mod.COL_LABEL).value or "").strip()
        if re.match(cfg_mod.MONTH_TITLE_PATTERN, value):
            titles += 1
    assert titles == client.expected_months, f"блоков {titles}"
```

и в шапку файла добавить импорты:

```python
import re

import calendar_config as cfg_mod
```

- [ ] **Step 3: Прогнать и убедиться, что падает**

Run: `python tests/test_client_config.py`
Expected: FAIL — `build() takes 1 positional argument but 2 were given` либо `AttributeError: module 'calendar_config' has no attribute 'ROW_DEFS'` после Task 3. На этом шаге ожидается ошибка сигнатуры.

- [ ] **Step 4: Переписать `make_reference_xlsx.py` под конфиг**

Изменения точечные, значения берутся из `client` вместо `cfg`:

- сигнатура: `def build(path, client, mode="demo"):`
- строка 201 `for row in cfg.ROW_DEFS:` → `for row in client.rows:`
- строка 281 `for i, row in enumerate(cfg.ROW_DEFS):` → `for i, row in enumerate(client.rows):`
- строка 295 `cfg.ACTIVITY_ROW_COUNT` → `client.activity_row_count`
- строки 321-322 `date.fromisoformat(cfg.RANGE_START)` / `RANGE_END` → `client.start_date` / `client.end_date`
- строка 353 `range(cfg.EXPECTED_MONTHS)` → `range(client.expected_months)`

Все прочие функции файла, принимающие `ws` и номер строки, получают дополнительный параметр `client` там, где обращались к `cfg.ROW_DEFS` или `cfg.ACTIVITY_ROW_COUNT`.

В `main()` добавить аргумент и загрузку:

```python
    ap.add_argument("--client",
                    default=str(root / "tests" / "fixtures" / "client-test.json"),
                    help="конфиг клиента, по которому строится книга")
    ap.add_argument("--out", default=str(root / ".tmp" / "reference-demo.xlsx"),
                    help="куда записать книгу")
    ...
    try:
        client = load_client(Path(args.client))
    except ClientConfigError as exc:
        fail(str(exc))
        return 2
```

и импорт в шапке: `from client_config import ClientConfigError, load_client`.

- [ ] **Step 5: Прогнать тест**

Run: `python tests/test_client_config.py`
Expected: `13/13 проверок прошло`

- [ ] **Step 6: Коммит**

```bash
git add tools/make_reference_xlsx.py tests/fixtures/client-test.json tests/test_client_config.py
git commit -m "Эталонная книга строится по конфигу клиента"
```

---

### Task 3: Конвертер принимает конфиг клиента

**Files:**
- Modify: `tools/xlsx_to_calendar_json.py` — функции `check_conditional_formatting` (145), `check_nothing_beyond` (326), `parse_block` (398), `validate_range` (592), `report_colors` (674), `convert` (727), `print_summary` (791), `main` (824)
- Modify: `tools/calendar_config.py` — удалить строки 18-21 и 55 и 88-99
- Modify: `tests/test_converter.py` — прокинуть фикстуру

**Interfaces:**
- Consumes: `ClientConfig`, `load_client`, `ClientConfigError` из Task 1.
- Produces: `convert(xlsx_path, out_path, client, report_only=False, autodetect=False)` — `client` третий позиционный параметр. `print_summary(payload, out_path, client)`.

- [ ] **Step 1: Написать падающие тесты на новый контракт**

Дописать в `tests/test_converter.py` три случая рядом с существующими (стиль совпадает с соседями — функция ломает книгу, декоратор объявляет ожидаемый фрагмент сообщения):

```python
@broken("диапазон таблицы шире объявленного в конфиге",
        expect="набор месяцев не совпадает")
def extra_month_block(wb, ws):
    """Дописываем 14-й блок: конфиг объявляет 13."""
    top = find_title_row(ws, "АВГУСТ 2027")
    bottom = top + cfg.OFFSET_FIRST_ACTIVITY + 8 + 2
    new_top = bottom + 1
    ws.cell(row=new_top, column=cfg.COL_LABEL).value = "СЕНТЯБРЬ 2027"
    ws.cell(row=new_top + cfg.OFFSET_DATES, column=cfg.COL_FIRST_DAY).value = 1


@broken("строк активностей меньше, чем объявлено в конфиге",
        expect="строк активностей")
def missing_activity_row(wb, ws):
    """Стираем подпись последней строки: конфиг объявляет восемь."""
    top = find_title_row(ws, "АВГУСТ 2026")
    row = top + cfg.OFFSET_FIRST_ACTIVITY + 7
    ws.cell(row=row, column=cfg.COL_LABEL).value = None


@broken("буква не из каталога и не из extraMarks",
        expect="неизвестн")
def unknown_mark(wb, ws):
    top = find_title_row(ws, "АВГУСТ 2026")
    row = top + cfg.OFFSET_FIRST_ACTIVITY
    ws.cell(row=row, column=cfg.COL_FIRST_DAY).value = "Ж"
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python tests/test_converter.py`
Expected: FAIL — `convert() missing 1 required positional argument: 'client'` (после правки вызова в тесте) либо три новых случая не остановят конвертер.

- [ ] **Step 3: Прокинуть `client` через конвертер**

Замены один в один, `cfg.X` → `client.X`:

| Строка | Было | Стало |
|---|---|---|
| 162 | `cfg.ACTIVITY_ROW_COUNT` | `client.activity_row_count` |
| 334 | `cfg.ACTIVITY_ROW_COUNT` | `client.activity_row_count` |
| 408, 416, 419 | `cfg.ACTIVITY_ROW_COUNT` | `client.activity_row_count` |
| 442 | `cfg.ROW_DEFS` | `client.rows` |
| 593-594 | `date.fromisoformat(cfg.RANGE_START/END)` | `client.start_date` / `client.end_date` |
| 597 | `cfg.EXPECTED_MONTHS` | `client.expected_months` |
| 619 | `cfg.RANGE_START[:7]` / `RANGE_END[:7]` | `client.range_start[:7]` / `client.range_end[:7]` |
| 621-628 | `cfg.EXPECTED_MONTHS` / `EXPECTED_DAYS` | `client.expected_months` / `client.expected_days` |
| 640 | `cfg.RANGE_START…RANGE_END` | `client.range_start…client.range_end` |
| 691 | `cfg.ACTIVITY_ROW_COUNT` | `client.activity_row_count` |
| 771 | `{"start": cfg.RANGE_START, ...}` | `{"start": client.range_start, "end": client.range_end}` |
| 772 | `cfg.ROW_DEFS` | `client.rows` |
| 810 | `cfg.EXPECTED_DAYS` | `client.expected_days` |

Каждая из функций `check_conditional_formatting`, `check_nothing_beyond`, `parse_block`, `validate_range`, `report_colors`, `convert`, `print_summary` получает параметр `client` и передаёт его дальше.

Проверка символов (`parse_marks`, строка 354) переходит с `cfg.KNOWN_MARKS` на `client.known_marks`, а `build_legend` (570) — с `cfg.MARK_TEXTS_FALLBACK` на `client.mark_texts`.

Проверку числа строк добавить в `parse_block` рядом с существующей проверкой раскладки, чтобы сообщение называло месяц:

```python
    # Число строк объявлено в конфиге клиента. Расхождение — стоп: у одного
    # клиента строк восемь, у другого может быть иначе, и «догадаться»
    # означало бы молча потерять или выдумать строку.
    if not label:
        raise ConvertError(
            f"{block['title']}: в строке {row_idx} нет подписи, а конфиг "
            f"объявляет {client.activity_row_count} строк активностей "
            f"(строки {block['first_activity_row']}–"
            f"{block['first_activity_row'] + client.activity_row_count - 1}).")
```

- [ ] **Step 4: Почистить `calendar_config.py`**

Удалить строки 18-21 (`RANGE_START`, `RANGE_END`, `EXPECTED_MONTHS`, `EXPECTED_DAYS`), строку 55 (`ACTIVITY_ROW_COUNT`) и строки 88-99 (`ROW_DEFS`, `ROW_IDS`). Заменить блок «Диапазон календаря» комментарием:

```python
# --------------------------------------------------------------------------
# Диапазон и строки живут в конфиге клиента
# --------------------------------------------------------------------------
# Раньше были константами здесь. Клиентов стало больше одного, и они
# различаются: год считается не всегда с августа, набор строк тоже свой.
# См. tools/client_config.py и clients/NN/client.json.
```

Добавить туда же базовый путь сайта — он нужен генератору для `id` в манифесте:

```python
# Базовый путь сайта на GitHub Pages: имя репозитория. Отсюда генератор
# строит абсолютный id в манифесте — относительный там не работает,
# он резолвится от origin, и у всех клиентов совпал бы.
SITE_BASE = "/bc/"
```

- [ ] **Step 5: Прокинуть конфиг в CLI и в тест**

В `main()` конвертера добавить `--client` (по умолчанию `clients/01/client.json`) и загрузку через `load_client`, ошибку печатать через `fail` с кодом 2.

В `tests/test_converter.py` в шапке добавить:

```python
from client_config import load_client

CLIENT = load_client(ROOT / "tests" / "fixtures" / "client-test.json")
```

и во всех вызовах `convert(...)` передать `CLIENT` третьим аргументом. Вызов `build(BASE)` заменить на `build(BASE, CLIENT)`.

- [ ] **Step 6: Прогнать тесты**

Run: `python tests/test_converter.py`
Expected: `19/19` — прежние 16 плюс три новых, все останавливают конвертер по нужной причине

Run: `python tests/test_client_config.py`
Expected: `13/13 проверок прошло`

- [ ] **Step 7: Коммит**

```bash
git add tools/xlsx_to_calendar_json.py tools/calendar_config.py tests/test_converter.py
git commit -m "Конвертер работает по конфигу клиента, а не по константам"
```

---

### Task 4: Переезд `docs/` → `app/`

**Files:**
- Move: `docs/*` → `app/` кроме `.nojekyll`, `robots.txt`, `data/`
- Modify: `tests/test_dates.mjs` — путь импорта
- Delete: `docs/data/calendar.json` (пересоберётся в Task 9)

**Interfaces:**
- Consumes: ничего.
- Produces: каталог `app/` с исходником оболочки.

- [ ] **Step 1: Перенести файлы**

```bash
mkdir app
git mv docs/index.html docs/styles.css docs/fonts.css docs/app.js docs/dates.js \
       docs/moon.js docs/store.js docs/validate.js docs/sw.js \
       docs/manifest.webmanifest docs/OFL.txt app/
git mv docs/icons app/icons
git rm -r --cached docs/data
rm -rf docs/data
```

`.nojekyll` и `robots.txt` остаются в `docs/` — они общие на весь сайт.

- [ ] **Step 2: Починить импорт в тесте дат**

В `tests/test_dates.mjs` заменить путь `../docs/dates.js` на `../app/dates.js`.

- [ ] **Step 3: Прогнать тест дат**

Run: `node tests/test_dates.mjs --all-zones`
Expected: 77 проверок × 11 поясов, все зелёные

- [ ] **Step 4: Коммит**

```bash
git add -A app docs tests/test_dates.mjs
git commit -m "Исходник оболочки переезжает в app/, docs/ становится сборкой"
```

---

### Task 5: Идентификатор клиента из адреса скрипта

**Files:**
- Create: `app/client-id.js`
- Create: `tests/test_client_id.mjs`
- Modify: `app/store.js:19` — `DB_NAME`
- Modify: `app/sw.js:14-15, 46-61, 75-98` — префикс кэша, чистка, поиск

**Interfaces:**
- Consumes: ничего.
- Produces: `app/client-id.js` экспортирует `clientIdFrom(href: string): string` и `CLIENT_ID: string`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/test_client_id.mjs`:

```js
/**
 * Идентификатор клиента выводится из адреса скрипта.
 *
 * Cache Storage и IndexedDB делятся по origin, а не по пути: все клиенты
 * на username.github.io живут в одном хранилище. Идентификатор разводит
 * их по папкам, и ошибка здесь означала бы чужие данные офлайн — молча.
 *
 * Запуск:  node tests/test_client_id.mjs
 */

import { clientIdFrom } from "../app/client-id.js";

let failed = 0;
function check(name, got, want) {
  if (got === want) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}: получено «${got}», ожидалось «${want}»`);
    failed++;
  }
}

check("боевой адрес клиента",
  clientIdFrom("https://yaroslavmalygin.github.io/bc/01/sw.js"), "01");
check("другой клиент",
  clientIdFrom("https://yaroslavmalygin.github.io/bc/02/store.js"), "02");
check("вложенный модуль берёт папку скрипта",
  clientIdFrom("https://yaroslavmalygin.github.io/bc/07/client-id.js"), "07");
check("локальный сервер над корнем — не пустая строка",
  clientIdFrom("http://127.0.0.1:8123/sw.js"), "local");
check("сервер над сборкой, клиент в подпапке",
  clientIdFrom("http://127.0.0.1:8123/a/sw.js"), "a");
check("хвостовой слэш не создаёт пустой сегмент",
  clientIdFrom("https://example.com/bc/01/"), "01");
check("query и hash не влияют",
  clientIdFrom("https://example.com/bc/01/sw.js?v=2#x"), "01");

console.log(failed ? `\n${failed} проверок упало` : "\n7/7 проверок прошло");
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node tests/test_client_id.mjs`
Expected: `ERR_MODULE_NOT_FOUND` — файла `app/client-id.js` нет

- [ ] **Step 3: Написать реализацию**

Создать `app/client-id.js`:

```js
/**
 * Идентификатор клиента — последний сегмент адреса ЭТОГО скрипта.
 *
 * Зачем вообще: Cache Storage, IndexedDB и localStorage делятся по origin,
 * а не по пути. Все календари живут на username.github.io, то есть в одном
 * хранилище. Без идентификатора два календаря на одном устройстве писали бы
 * в одну базу, а чистка старых кэшей у одного сносила бы офлайн-оболочку
 * другого. Офлайновое приложение показало бы это не сразу и не явно.
 *
 * Берём адрес скрипта, а не документа: от документа идентификатор поехал бы
 * при другом имени входной страницы.
 *
 * Ничего не подставляется при сборке: папка и идентификатор совпадают по
 * построению, рассинхрон невозможен.
 */

export function clientIdFrom(href) {
  // new URL("./", …) отбрасывает имя файла, query и hash — остаётся папка.
  const path = new URL("./", href).pathname;
  const segment = path.split("/").filter(Boolean).pop();
  // Пустой сегмент бывает на локальном сервере, поднятом над самой папкой
  // клиента. Пустое имя базы недопустимо, поэтому явная замена.
  return segment || "local";
}

export const CLIENT_ID = clientIdFrom(import.meta.url);
```

- [ ] **Step 4: Прогнать тест**

Run: `node tests/test_client_id.mjs`
Expected: `7/7 проверок прошло`

- [ ] **Step 5: Развести хранилище в `store.js`**

В `app/store.js` заменить строку 19:

```js
import { CLIENT_ID } from "./client-id.js";

// Имя базы содержит идентификатор клиента: IndexedDB делится по origin,
// и без него два календаря на одном устройстве писали бы в одну базу.
const DB_NAME = `business-calendar-${CLIENT_ID}`;
```

Импорт добавить рядом с существующим импортом `validateCalendar`. `lsKey()` строит ключ из `DB_NAME`, поэтому запасной путь через localStorage разводится сам.

- [ ] **Step 6: Развести кэш в `sw.js`**

В `app/sw.js` заменить строки 14-15:

```js
const APP_CACHE_VERSION = "v1";

// Тот же вывод идентификатора, что в client-id.js. Дублируется намеренно:
// sw.js — классический воркер, ESM-импорт здесь недоступен без
// type: "module" при регистрации, а его не держат старые iOS.
function clientIdFrom(href) {
  const path = new URL("./", href).pathname;
  const segment = path.split("/").filter(Boolean).pop();
  return segment || "local";
}

const CLIENT_ID = clientIdFrom(self.location.href);
const CACHE_PREFIX = `calendar-${CLIENT_ID}-shell-`;
const CACHE_NAME = CACHE_PREFIX + APP_CACHE_VERSION;
```

В `PRECACHE` добавить `"./client-id.js"` — иначе офлайн он не откроется и `store.js` не загрузится.

В `activate` (строка 55) заменить фильтр:

```js
        names
          // Только СВОИ прошлые версии. Общий префикс calendar-shell- снёс бы
          // офлайн-оболочку остальных клиентов: кэши общие на весь origin.
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
```

В `fetch` (строка 77) заменить глобальный поиск на поиск в своём кэше:

```js
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
```

и ниже, в ветке навигации без сети (строка 91), `caches.match("./index.html")` → `cache.match("./index.html")`.

- [ ] **Step 7: Прогнать тесты**

Run: `node tests/test_client_id.mjs`
Expected: `7/7 проверок прошло`

Run: `node tests/test_dates.mjs --all-zones`
Expected: все зелёные

- [ ] **Step 8: Коммит**

```bash
git add app/client-id.js app/store.js app/sw.js tests/test_client_id.mjs
git commit -m "Изоляция клиентов: идентификатор из адреса скрипта"
```

---

### Task 6: Генератор `tools/build_client.py`

**Files:**
- Create: `tools/build_client.py`
- Modify: `app/manifest.webmanifest` — убрать строку 2 с `id`

**Interfaces:**
- Consumes: `SITE_BASE` из `calendar_config`, `load_client` из Task 1.
- Produces: `build_client(client_id: str, root: Path) -> Path` — собирает `docs/<client_id>/`, возвращает путь. CLI: `python tools/build_client.py NN` и `python tools/build_client.py --all`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/test_build_client.py`:

```python
"""
Проверка генератора клиентских сборок.

Главное здесь — что пересборка оболочки НЕ трогает данные. Исходный .xlsx
лежит под .gitignore, на чистом клоне его нет, и затирающая пересборка
стёрла бы календари всех клиентов разом.

Запуск:  python tests/test_build_client.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from build_client import build_client
from console import BOLD, RESET, fail, head, info, ok

WORK = ROOT / ".tmp" / "buildtest"

CASES = []


def case(name):
    def deco(fn):
        CASES.append((name, fn))
        return fn
    return deco


def fresh_root():
    """Мини-репозиторий: app/ с парой файлов и clients/ с конфигом."""
    import shutil
    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "app" / "icons").mkdir(parents=True)
    (WORK / "app" / "index.html").write_text("<p>тест</p>", encoding="utf-8")
    (WORK / "app" / "sw.js").write_text("// воркер", encoding="utf-8")
    (WORK / "app" / "icons" / "icon-192.png").write_bytes(b"\x89PNG")
    (WORK / "app" / "manifest.webmanifest").write_text(
        json.dumps({"name": "Календарь", "start_url": "./", "scope": "./"},
                   ensure_ascii=False),
        encoding="utf-8")
    (WORK / "clients" / "07").mkdir(parents=True)
    (WORK / "clients" / "07" / "client.json").write_text(json.dumps({
        "range": {"start": "2026-09-01", "end": "2027-09-30"},
        "rows": [{"id": "a", "label": "А", "short": "А"}],
        "extraMarks": {},
    }, ensure_ascii=False), encoding="utf-8")
    return WORK


@case("оболочка копируется целиком, включая иконки")
def _():
    root = fresh_root()
    out = build_client("07", root)
    assert (out / "index.html").exists()
    assert (out / "sw.js").exists()
    assert (out / "icons" / "icon-192.png").exists()


@case("манифест получает абсолютный id с папкой клиента")
def _():
    root = fresh_root()
    out = build_client("07", root)
    manifest = json.loads((out / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["id"] == "/bc/07/", manifest.get("id")
    # start_url и scope остаются относительными: они резолвятся от манифеста
    assert manifest["start_url"] == "./", manifest["start_url"]


@case("пересборка НЕ трогает данные клиента")
def _():
    root = fresh_root()
    out = build_client("07", root)
    data = out / "data" / "calendar.json"
    data.parent.mkdir(parents=True, exist_ok=True)
    data.write_text('{"version":1,"метка":"не трогать"}', encoding="utf-8")

    build_client("07", root)

    assert data.exists(), "данные исчезли при пересборке"
    assert "не трогать" in data.read_text(encoding="utf-8"), "данные перезаписаны"


@case("лишний файл от прошлой сборки убирается")
def _():
    root = fresh_root()
    out = build_client("07", root)
    stale = out / "old-thing.js"
    stale.write_text("// хлам", encoding="utf-8")

    build_client("07", root)

    assert not stale.exists(), "файл прошлой сборки остался"


@case("клиента без конфига собрать нельзя")
def _():
    root = fresh_root()
    try:
        build_client("99", root)
    except Exception as exc:
        assert "99" in str(exc), exc
        return
    raise AssertionError("ожидалась ошибка про отсутствующий конфиг")


def main():
    head("Генератор клиентских сборок")
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            ok(name)
        except AssertionError as exc:
            fail(f"{name}: {exc}")
            failed += 1
    head("Итог")
    info(f"{BOLD}{len(CASES) - failed}/{len(CASES)}{RESET} проверок прошло")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python tests/test_build_client.py`
Expected: `ModuleNotFoundError: No module named 'build_client'`

- [ ] **Step 3: Написать генератор**

Создать `tools/build_client.py`:

```python
"""
Сборка клиентской папки: app/ → docs/NN/.

Оболочка копируется целиком, чтобы папка клиента была самодостаточной.
Общий код на всех сэкономил бы место, но правка тихо меняла бы поведение у
всех клиентов без пересборки и без прогона тестов на их данных — для
офлайнового приложения это шаг назад.

Данные генератор НЕ трогает. Исходный .xlsx лежит под .gitignore, на чистом
клоне его нет, и затирающая пересборка стёрла бы календари всех клиентов
разом — а офлайновое приложение показало бы это не сразу.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import calendar_config as cfg
from client_config import ClientConfigError, load_client
from console import fail, head, info, ok

DATA_DIRNAME = "data"


class BuildError(Exception):
    """Сборка невозможна. Сообщение говорит, что править."""


def build_client(client_id, root):
    root = Path(root)
    app_dir = root / "app"
    config_path = root / "clients" / client_id / "client.json"
    out_dir = root / "docs" / client_id

    if not app_dir.is_dir():
        raise BuildError(f"нет каталога оболочки: {app_dir}")
    if not config_path.exists():
        raise BuildError(
            f"у клиента {client_id} нет конфига: {config_path}. "
            "Заведите его по workflows/add_client.md")

    # Конфиг читаем не ради содержимого, а чтобы негодный не доехал до
    # публикации: пусть сборка падает здесь, а не в приложении на телефоне.
    load_client(config_path)

    # Данные принадлежат конвертеру. Сохраняем их через переезд, а не
    # копированием: так они не задваиваются даже на секунду.
    data_dir = out_dir / DATA_DIRNAME
    stash = None
    if data_dir.is_dir():
        stash = out_dir.parent / f".{client_id}-data-stash"
        if stash.exists():
            shutil.rmtree(stash)
        shutil.move(str(data_dir), str(stash))

    # Сносим прошлую сборку целиком: иначе файл, удалённый из app/, остался
    # бы у клиента навсегда и продолжал раздаваться.
    if out_dir.exists():
        shutil.rmtree(out_dir)
    shutil.copytree(app_dir, out_dir)

    if stash is not None:
        shutil.move(str(stash), str(data_dir))

    write_manifest(app_dir, out_dir, client_id)
    return out_dir


def write_manifest(app_dir, out_dir, client_id):
    """Единственный файл, который не копируется как есть.

    Относительный id в манифесте не подходит: он резолвится от origin, а не
    от папки, поэтому «./» дало бы всем клиентам один и тот же
    идентификатор. Пишем абсолютный.
    """
    source = app_dir / "manifest.webmanifest"
    manifest = json.loads(source.read_text(encoding="utf-8"))
    manifest["id"] = f"{cfg.SITE_BASE}{client_id}/"

    # id первым ключом — так его видно в диффе сразу.
    ordered = {"id": manifest.pop("id"), **manifest}
    (out_dir / "manifest.webmanifest").write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")


def known_clients(root):
    clients_dir = Path(root) / "clients"
    if not clients_dir.is_dir():
        return []
    return sorted(p.name for p in clients_dir.iterdir()
                  if (p / "client.json").exists())


def main():
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description="app/ → docs/NN/")
    ap.add_argument("client", nargs="?", help="номер клиента, например 01")
    ap.add_argument("--all", action="store_true",
                    help="пересобрать оболочку всем клиентам")
    ap.add_argument("--root", default=str(root),
                    help="корень, откуда берутся app/ и clients/ "
                         "(нужен браузерным тестам, они собирают в .tmp)")
    args = ap.parse_args()
    root = Path(args.root).resolve()

    if args.all == bool(args.client):
        fail("укажите либо номер клиента, либо --all")
        return 2

    # Список берём из clients/, а не из docs/: источник правды — вход,
    # а не результат прошлой сборки.
    targets = known_clients(root) if args.all else [args.client]
    if not targets:
        fail("в clients/ нет ни одного клиента с client.json")
        return 2

    head("Сборка клиентских папок")
    for client_id in targets:
        try:
            out = build_client(client_id, root)
        except (BuildError, ClientConfigError) as exc:
            fail(f"{client_id}: {exc}")
            return 1
        ok(f"{client_id} → {out.relative_to(root)}")

    info("данные не тронуты: их пишет только конвертер")
    if args.all:
        info("не забудьте поднять APP_CACHE_VERSION в app/sw.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Убрать `id` из исходника манифеста**

В `app/manifest.webmanifest` удалить строку 2 (`"id": "/bc-2026-1/",`). Значение пишет генератор — в исходнике оно было бы неверным для всех клиентов, кроме одного.

- [ ] **Step 5: Прогнать тест**

Run: `python tests/test_build_client.py`
Expected: `5/5 проверок прошло`

- [ ] **Step 6: Коммит**

```bash
git add tools/build_client.py tests/test_build_client.py app/manifest.webmanifest
git commit -m "Генератор клиентских сборок, данные не трогает"
```

---

### Task 7: Браузерные тесты переезжают на тестовую сборку

**Files:**
- Modify: `tests/test_app.mjs:22, 61` — корень сервера
- Create: `tests/build_fixture.mjs` — общая подготовка сборки для браузерных тестов

**Interfaces:**
- Consumes: `build_client` (через `python tools/build_client.py`), конвертер, фикстуру `tests/fixtures/client-test.json`.
- Produces: `tests/build_fixture.mjs` экспортирует `buildFixture(ids: string[]): Promise<string>` — собирает клиентов в `.tmp/build/` и возвращает абсолютный путь этого каталога.

- [ ] **Step 1: Написать помощник сборки фикстуры**

Создать `tests/build_fixture.mjs`:

```js
/**
 * Готовит настоящую клиентскую сборку для браузерных тестов.
 *
 * Раньше тесты поднимали сервер над docs/ с боевыми данными. Теперь docs/ —
 * результат сборки, и зависеть от того, заведён ли живой клиент, тестам
 * незачем. Собираем во временный каталог из эталонной книги.
 *
 * Сервер поднимается над РОДИТЕЛЬСКИМ каталогом, а клиент лежит в подпапке:
 * иначе сегмент пути пуст, идентификатор становится «local» и изоляцию
 * не проверить по-настоящему.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BUILD = resolve(ROOT, ".tmp", "build");
const FIXTURE = resolve(ROOT, "tests", "fixtures", "client-test.json");
const REF_XLSX = resolve(ROOT, ".tmp", "reference-demo.xlsx");

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} упал:\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

export async function buildFixture(ids) {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });

  run("python", ["tools/make_reference_xlsx.py", "--mode", "demo",
                 "--client", FIXTURE, "--out", REF_XLSX]);

  for (const id of ids) {
    // Конфиг клиента нужен генератору — кладём фикстуру под номером.
    const clientDir = resolve(ROOT, ".tmp", "clients", id);
    mkdirSync(clientDir, { recursive: true });
    cpSync(FIXTURE, resolve(clientDir, "client.json"));
  }

  // Генератор работает от корня репозитория, поэтому собираем в docs/ и
  // переносим — так тест не зависит от внутренностей build_client.
  for (const id of ids) {
    run("python", ["tools/build_client.py", id, "--root", ".tmp"]);
    cpSync(resolve(ROOT, ".tmp", "docs", id), resolve(BUILD, id),
           { recursive: true });
    run("python", ["tools/xlsx_to_calendar_json.py",
                   "--xlsx", REF_XLSX,
                   "--client", FIXTURE,
                   "--out", resolve(BUILD, id, "data", "calendar.json")]);
  }

  return BUILD;
}
```

Для этого `tools/build_client.py` получает аргумент `--root` (по умолчанию корень репозитория), а `make_reference_xlsx.py` — аргумент `--out`. Оба тривиальны и добавляются здесь же.

- [ ] **Step 2: Переключить `test_app.mjs` на сборку**

В `tests/test_app.mjs`:

- строку 22 `const DOCS = resolve(ROOT, "docs");` заменить на `let SERVE_ROOT;`
- перед `startServer()` (строка 109) добавить:

```js
  // Сервер над каталогом сборки, клиент в подпапке /app-test/ — так путь
  // непустой и идентификатор клиента выводится по-настоящему.
  SERVE_ROOT = await buildFixture(["app-test"]);
```

- строку 61 `"--directory", DOCS` заменить на `"--directory", SERVE_ROOT`
- все переходы браузера с `http://127.0.0.1:8123/` заменить на `http://127.0.0.1:8123/app-test/`
- в шапку добавить `import { buildFixture } from "./build_fixture.mjs";`

- [ ] **Step 3: Прогнать браузерные тесты**

Run: `node tests/test_app.mjs`
Expected: 69 проверок зелёные, скриншоты в `.tmp/screens/`

- [ ] **Step 4: Коммит**

```bash
git add tests/test_app.mjs tests/build_fixture.mjs tools/build_client.py tools/make_reference_xlsx.py
git commit -m "Браузерные тесты гоняются на собранной фикстуре, а не на docs/"
```

---

### Task 8: `tests/test_clients.mjs` — изоляция двух клиентов

**Files:**
- Create: `tests/test_clients.mjs`

**Interfaces:**
- Consumes: `buildFixture` из Task 7.
- Produces: ничего.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/test_clients.mjs`:

```js
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
  const server = spawn("python",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", root],
    { stdio: "ignore" });
  return server;
}

async function waitReady(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    null, { timeout: 15000 });
}

async function main() {
  const root = await buildFixture(["a", "b"]);
  const server = startServer(root);
  await new Promise((r) => setTimeout(r, 800));

  const browser = await chromium.launch();
  // Один контекст на обоих клиентов — это и есть «один телефон».
  const context = await browser.newContext();

  try {
    const pageA = await context.newPage();
    await pageA.goto(`${BASE}/a/`);
    await waitReady(pageA);

    const pageB = await context.newPage();
    await pageB.goto(`${BASE}/b/`);
    await waitReady(pageB);

    const dbs = await pageA.evaluate(async () =>
      (await indexedDB.databases()).map((d) => d.name).sort());
    check("базы IndexedDB разведены по клиентам",
      dbs.includes("business-calendar-a") && dbs.includes("business-calendar-b"),
      JSON.stringify(dbs));

    const caches = await pageA.evaluate(async () => (await window.caches.keys()).sort());
    check("кэши оболочки разведены по клиентам",
      caches.some((n) => n.startsWith("calendar-a-shell-")) &&
      caches.some((n) => n.startsWith("calendar-b-shell-")),
      JSON.stringify(caches));

    check("общего кэша calendar-shell- не осталось",
      !caches.some((n) => n.startsWith("calendar-shell-")),
      JSON.stringify(caches));

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

    const markerSeenByB = await pageB.evaluate(async () => {
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
      return value && value["метка"];
    });
    check("подмена данных у клиента A не видна клиенту B",
      markerSeenByB !== "версия клиента A", String(markerSeenByB));

    // Главная проверка: подъём версии у одного не сносит оболочку другого.
    const cachesBefore = await pageA.evaluate(async () => (await window.caches.keys()).sort());
    await pageA.evaluate(async () => {
      // Имитируем активацию новой версии воркера клиента A: он чистит
      // кэши по СВОЕМУ префиксу. Кэш клиента B обязан уцелеть.
      const names = await window.caches.keys();
      const mine = names.filter((n) => n.startsWith("calendar-a-shell-"));
      await Promise.all(mine.map((n) => window.caches.delete(n)));
    });
    const cachesAfter = await pageA.evaluate(async () => (await window.caches.keys()).sort());
    check("чистка у клиента A не тронула кэш клиента B",
      cachesAfter.some((n) => n.startsWith("calendar-b-shell-")),
      `${JSON.stringify(cachesBefore)} → ${JSON.stringify(cachesAfter)}`);

    // Манифесты обязаны иметь разные id, иначе установка спутает приложения.
    const idA = await pageA.evaluate(async () =>
      (await (await fetch("./manifest.webmanifest")).json()).id);
    const idB = await pageB.evaluate(async () =>
      (await (await fetch("./manifest.webmanifest")).json()).id);
    check("id в манифестах разные", idA !== idB, `${idA} и ${idB}`);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(failed ? `\n${failed} проверок упало` : "\nвсе проверки прошли");
  process.exit(failed ? 1 : 0);
}

main();
```

- [ ] **Step 2: Убедиться, что тест ловит поломку**

Task 5 уже развёл идентификаторы, поэтому тест обязан быть зелёным. Чтобы
проверить, что он вообще способен покраснеть, временно вернуть в `app/sw.js`
общий префикс:

```js
const CACHE_PREFIX = "calendar-shell-";
```

Run: `node tests/test_clients.mjs`
Expected: FAIL на «кэши оболочки разведены по клиентам» и на «общего кэша
calendar-shell- не осталось»

Вернуть строку как была (`calendar-${CLIENT_ID}-shell-`).

- [ ] **Step 3: Прогнать на исправленном коде**

Run: `node tests/test_clients.mjs`
Expected: все проверки зелёные

- [ ] **Step 4: Коммит**

```bash
git add tests/test_clients.mjs
git commit -m "Тест изоляции двух клиентов в одном браузере"
```

---

### Task 9: Миграция первого клиента

**Files:**
- Create: `clients/01/client.json`
- Modify: `.gitignore`
- Create: `docs/01/` (сборка)

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: рабочая сборка первого клиента.

- [ ] **Step 1: Завести конфиг клиента 01**

Создать `clients/01/client.json` с текущим диапазоном и нынешними восемью строками — содержимое совпадает с `tests/fixtures/client-test.json`, потому что это ровно то, что было константами.

- [ ] **Step 2: Закрыть исходники от git**

В `.gitignore` добавить:

```
# Исходники астролога: заметки до вычистки стоп-слов, в публичный
# репозиторий им нельзя. Конфиг клиента рядом — коммитится, в нём нет имён.
clients/*/*.xlsx
```

- [ ] **Step 3: Собрать клиента**

```bash
python tools/make_reference_xlsx.py --mode demo --client clients/01/client.json --out .tmp/reference-demo.xlsx
python tools/build_client.py 01
python tools/xlsx_to_calendar_json.py --xlsx .tmp/reference-demo.xlsx --client clients/01/client.json --out docs/01/data/calendar.json
```

Expected: конвертер печатает 396 дней, 13 месяцев, шлюз публикации валит `provisional` — это ожидаемо, данные демонстрационные.

- [ ] **Step 4: Проверить локально**

```bash
python -m http.server 8000 --directory docs
```

Открыть `http://127.0.0.1:8000/01/`, убедиться, что календарь открывается и плашка «предварительные данные» на месте.

- [ ] **Step 5: Прогнать все тесты**

```bash
python tests/test_client_config.py
python tests/test_build_client.py
python tests/test_converter.py
node tests/test_dates.mjs --all-zones
node tests/test_client_id.mjs
node tests/test_app.mjs
node tests/test_clients.mjs
```

Expected: все зелёные

- [ ] **Step 6: Коммит**

```bash
git add clients/01/client.json .gitignore docs/01
git commit -m "Первый клиент переезжает в docs/01"
```

---

### Task 10: Воркфлоу и документация

**Files:**
- Create: `workflows/add_client.md`
- Modify: `workflows/update_calendar_data.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: SOP, по которому заводится клиент.

- [ ] **Step 1: Написать `workflows/add_client.md`**

Разделы по шагам спеки: номер клиента, интервью (диапазон, строки, новые буквы), приём `.xlsx`, `--report-colors`, холостой прогон в `.tmp`, сверка символов с каталогом, показ заметок месяцев Яро, сборка, тесты, коммит и пуш, `test_live.mjs` по адресу клиента, передача ссылки.

Отдельным разделом — что делать, если конвертер остановился: сообщение называет месяц и ячейку, правится таблица, а не конвертер.

- [ ] **Step 2: Переписать `workflows/update_calendar_data.md`**

Заменить единственный календарь на «клиент NN»: пути `clients/NN/calendar.xlsx` и `docs/NN/data/calendar.json`, команды с `--client`. Добавить раздел про правку приложения: поднять `APP_CACHE_VERSION` в `app/sw.js`, затем `python tools/build_client.py --all`.

- [ ] **Step 3: Обновить `CLAUDE.md`**

- раздел «Что это»: адрес становится `https://yaroslavmalygin.github.io/bc/NN/`, диапазон перестаёт быть фиксированным и описывается как свойство клиента;
- команды: добавить `build_client.py`, `--client` у конвертера и эталонной книги, новые тесты;
- новый инвариант «Идентификатор клиента выводится из адреса скрипта» — почему хранилище делится по origin, почему префикс кэша свой, почему `id` в манифесте абсолютный;
- новый инвариант «Диапазон и строки живут в конфиге клиента» — почему `EXPECTED_*` вычисляются, а не задаются;
- инвариант «Оболочка и данные разделены» — почему `--all` не трогает `data/`;
- раздел «Заполненность месяцев» и остальные — без изменений.

- [ ] **Step 4: Обновить `README.md`**

Структура каталогов, новый порядок запуска, ссылка на `workflows/add_client.md`.

- [ ] **Step 5: Коммит**

```bash
git add workflows CLAUDE.md README.md
git commit -m "Воркфлоу заведения клиента и обновлённые инварианты"
```

---

### Task 11: Переименование репозитория и боевая проверка

**Files:**
- Modify: `tests/test_live.mjs:18, 97, 99`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: рабочий боевой адрес `https://yaroslavmalygin.github.io/bc/01/`.

- [ ] **Step 1: Переименовать репозиторий**

Делает Яро: GitHub → репозиторий `bc-2026-1` → Settings → General → Repository name → `bc` → Rename.

Затем локально:

```bash
git remote set-url origin https://github.com/yaroslavmalygin/bc.git
git remote -v
```

- [ ] **Step 2: Поправить адрес по умолчанию в тесте**

В `tests/test_live.mjs` заменить строку 18:

```js
const BASE = process.argv[2] || "https://yaroslavmalygin.github.io/bc/01/";
```

и в строках 97, 99 заменить проверку `includes("/bc-2026-1/")` на `includes("/bc/01/")`.

- [ ] **Step 3: Запушить**

```bash
git push origin main
```

- [ ] **Step 4: Дождаться публикации и проверить боевой адрес**

Run: `node tests/test_live.mjs`
Expected: 17 проверок зелёные, включая «calendar.json в кэше воркера нет»

Если Pages ещё не пересобрался, подождать и повторить — на публикацию уходит до пары минут.

- [ ] **Step 5: Коммит**

```bash
git add tests/test_live.mjs
git commit -m "Боевой адрес переезжает на /bc/01/"
git push origin main
```

---

## Проверка целиком

После Task 11 всё должно проходить одной пачкой:

```bash
python tests/test_client_config.py
python tests/test_build_client.py
python tests/test_converter.py
node tests/test_dates.mjs --all-zones
node tests/test_client_id.mjs
node tests/test_app.mjs
node tests/test_clients.mjs
node tests/test_live.mjs
```

Ручная проверка, которую автоматика не заменяет: открыть `https://yaroslavmalygin.github.io/bc/01/` на настоящем телефоне, поставить на домашний экран, включить авиарежим, убедиться, что календарь открывается офлайн.

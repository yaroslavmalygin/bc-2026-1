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

import calendar_config as cfg_mod
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


@case("эталонная книга строится по конфигу и даёт нужное число блоков")
def _():
    from make_reference_xlsx import build
    from openpyxl import load_workbook
    # Блоки ищем логикой самого конвертера: заголовок месяца продублирован
    # в строках дней недели и дат, и наивный подсчёт совпадений дал бы втрое
    # больше блоков, чем их есть.
    from xlsx_to_calendar_json import find_blocks

    client = load_client(ROOT / "tests" / "fixtures" / "client-test.json")
    WORK.mkdir(parents=True, exist_ok=True)
    path = WORK / "ref-from-config.xlsx"
    build(path, client, mode="demo")

    wb = load_workbook(path)
    ws = wb[cfg_mod.CALENDAR_SHEET_CANDIDATES[0]]
    blocks = find_blocks(ws)
    assert len(blocks) == client.expected_months, f"блоков {len(blocks)}"


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

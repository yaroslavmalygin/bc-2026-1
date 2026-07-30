"""
Проверка конвертера на намеренно сломанных книгах.

Каждый тест берёт эталонную книгу, вносит ровно одну поломку и требует,
чтобы конвертер остановился с внятным сообщением. Смысл не в том, что он
упадёт, а в том, что упадёт по нужной причине и назовёт месяц или ячейку:
молча испорченные данные в офлайновом приложении не заметит никто.

Запуск:  python tests/test_converter.py
"""

import shutil
import sys
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import PatternFill

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import calendar_config as cfg
import console
from console import BOLD, DIM, RESET, fail, head, info, ok
from make_reference_xlsx import build
from xlsx_to_calendar_json import ConvertError, convert

WORK = ROOT / ".tmp" / "fixtures"
BASE = WORK / "base-demo.xlsx"


# ---------------------------------------------------------------------------
# Инструменты поломки
# ---------------------------------------------------------------------------

def fresh_copy(name):
    dst = WORK / f"{name}.xlsx"
    shutil.copyfile(BASE, dst)
    return dst


def calendar_ws(wb):
    return wb[cfg.CALENDAR_SHEET_CANDIDATES[0]]


def find_title_row(ws, title):
    for r in range(1, ws.max_row + 1):
        if str(ws.cell(row=r, column=cfg.COL_LABEL).value or "").strip() == title:
            probe = ws.cell(row=r + cfg.OFFSET_DATES, column=cfg.COL_FIRST_DAY).value
            try:
                if int(str(probe).strip()) == 1:
                    return r
            except (TypeError, ValueError):
                continue
    raise AssertionError(f"не найден блок {title}")


def edit(name, mutate):
    """Копирует эталон, применяет поломку, возвращает путь."""
    path = fresh_copy(name)
    wb = load_workbook(path)
    mutate(wb, calendar_ws(wb))
    wb.save(path)
    return path


# ---------------------------------------------------------------------------
# Поломки
# ---------------------------------------------------------------------------

def break_missing_day(wb, ws):
    r = find_title_row(ws, "СЕНТЯБРЬ 2026") + cfg.OFFSET_DATES
    ws.cell(row=r, column=cfg.COL_FIRST_DAY + 14).value = None


def break_duplicate_day(wb, ws):
    r = find_title_row(ws, "ОКТЯБРЬ 2026") + cfg.OFFSET_DATES
    ws.cell(row=r, column=cfg.COL_FIRST_DAY + 9).value = 9


def break_february_length(wb, ws):
    top = find_title_row(ws, "ФЕВРАЛЬ 2027")
    r = top + cfg.OFFSET_DATES
    # Дорисовываем 29-й день, которого в 2027 году нет.
    ws.cell(row=r, column=cfg.COL_FIRST_DAY + 28).value = 29


def break_missing_month(wb, ws):
    """Блок марта перестаёт опознаваться целиком.

    Статус в колонке A тоже убираем: иначе он попадёт в диапазон поиска
    предыдущего месяца и первой сработает проверка «несколько статусов»,
    а мы хотим проверить именно контроль набора месяцев.
    """
    top = find_title_row(ws, "МАРТ 2027")
    ws.cell(row=top, column=cfg.COL_LABEL).value = None
    ws.cell(row=top, column=cfg.COL_STATUS).value = None
    ws.cell(row=top + cfg.OFFSET_DATES, column=cfg.COL_FIRST_DAY).value = None


def break_duplicate_month(wb, ws):
    """Два блока с одним ключом месяца.

    Берём май и март — оба по 31 дню. Если подменить месяц на другой по
    длине, первой сработает проверка числа дней, и до контроля дублей
    дело не дойдёт.
    """
    top = find_title_row(ws, "МАЙ 2027")
    ws.cell(row=top, column=cfg.COL_LABEL).value = "МАРТ 2027"


def break_unknown_color(wb, ws):
    top = find_title_row(ws, "МАЙ 2027")
    cell = ws.cell(row=top + cfg.OFFSET_FIRST_ACTIVITY, column=cfg.COL_FIRST_DAY + 3)
    cell.fill = PatternFill(start_color="FF7B1FA2", end_color="FF7B1FA2", fill_type="solid")


def break_conditional_formatting(wb, ws):
    top = find_title_row(ws, "ИЮНЬ 2027")
    r1 = top + cfg.OFFSET_FIRST_ACTIVITY
    r2 = r1 + cfg.ACTIVITY_ROW_COUNT - 1
    rng = f"C{r1}:AG{r2}"
    ws.conditional_formatting.add(
        rng,
        CellIsRule(operator="equal", formula=['"О"'],
                   fill=PatternFill(start_color="FF00FF00", end_color="FF00FF00",
                                    fill_type="solid")))


def break_unknown_mark(wb, ws):
    top = find_title_row(ws, "ИЮЛЬ 2027")
    ws.cell(row=top + cfg.OFFSET_FIRST_ACTIVITY, column=cfg.COL_FIRST_DAY + 5).value = "Ж"


def break_status_typo(wb, ws):
    top = find_title_row(ws, "ДЕКАБРЬ 2026")
    ws.cell(row=top, column=cfg.COL_STATUS).value = "STATUS: REDY"


def break_double_status(wb, ws):
    top = find_title_row(ws, "ЯНВАРЬ 2027")
    ws.cell(row=top + 2, column=cfg.COL_STATUS).value = cfg.STATUS_READY


def break_moon_same_type(wb, ws):
    # Красим 20 сентября тем же тёмно-синим, что и ближайшее полнолуние,
    # получая два полнолуния подряд.
    top = find_title_row(ws, "СЕНТЯБРЬ 2026")
    r = top + cfg.OFFSET_DATES
    full_hex = next(h for h, v in cfg.PALETTE_DATES.items() if v == "moon_full")
    ws.cell(row=r, column=cfg.COL_FIRST_DAY + 19).fill = PatternFill(
        start_color="FF" + full_hex, end_color="FF" + full_hex, fill_type="solid")


def break_nine_activity_rows(wb, ws):
    top = find_title_row(ws, "НОЯБРЬ 2026")
    r = top + cfg.OFFSET_FIRST_ACTIVITY + cfg.ACTIVITY_ROW_COUNT
    ws.cell(row=r, column=cfg.COL_LABEL).value = "Лишняя девятая строка"


def break_seven_activity_rows(wb, ws):
    top = find_title_row(ws, "ОКТЯБРЬ 2026")
    r = top + cfg.OFFSET_FIRST_ACTIVITY + cfg.ACTIVITY_ROW_COUNT - 1
    ws.cell(row=r, column=cfg.COL_LABEL).value = None


def break_leftover_right(wb, ws):
    # Сентябрь тридцатидневный: оставляем в 31-й колонке августовскую заливку.
    top = find_title_row(ws, "СЕНТЯБРЬ 2026")
    r = top + cfg.OFFSET_FIRST_ACTIVITY
    good_hex = next(h for h, v in cfg.PALETTE_ACTIVITY.items() if v == "good")
    ws.cell(row=r, column=cfg.COL_FIRST_DAY + 30).fill = PatternFill(
        start_color="FF" + good_hex, end_color="FF" + good_hex, fill_type="solid")


def break_sheet_renamed(wb, ws):
    ws.title = "Данные за год"
    legend = wb[cfg.LEGEND_SHEET_CANDIDATES[0]]
    legend.title = "Пояснения"


def break_dates_not_number(wb, ws):
    top = find_title_row(ws, "МАЙ 2027")
    ws.cell(row=top + cfg.OFFSET_DATES, column=cfg.COL_FIRST_DAY + 4).value = "пять"


# ---------------------------------------------------------------------------
# Реестр
# ---------------------------------------------------------------------------
# expect — фрагмент, который обязан встретиться в тексте ошибки. Проверяем
# не только факт падения, но и что оно указывает на настоящую причину.

CASES = [
    ("пропущенный день",                break_missing_day,             "не подряд"),
    ("продублированный день",           break_duplicate_day,           "повторяются"),
    ("неверная длина февраля",          break_february_length,         "не високосный"),
    ("пропущенный месяц",               break_missing_month,           "не хватает"),
    ("продублированный месяц",          break_duplicate_month,         "повторяются"),
    ("неизвестный цвет",                break_unknown_color,           "не описана"),
    ("условное форматирование",         break_conditional_formatting,  "условное форматирование"),
    ("неизвестная буква",               break_unknown_mark,            "неизвестный символ"),
    ("опечатка в STATUS",               break_status_typo,             "ожидается"),
    ("два STATUS в блоке",              break_double_status,           "несколько статусов"),
    ("две одинаковые фазы подряд",      break_moon_same_type,          "чередоваться"),
    ("девять строк активностей",        break_nine_activity_rows,      "девятая"),
    ("семь строк активностей",          break_seven_activity_rows,     "подписи строк"),
    ("остатки справа от месяца",        break_leftover_right,          "справа от последнего дня"),
    ("переименованный лист",            break_sheet_renamed,           "не найден лист"),
    ("нечисло в строке дат",            break_dates_not_number,        "не число"),
]


# ---------------------------------------------------------------------------
# Запуск
# ---------------------------------------------------------------------------

def run_case(name, mutate, expect):
    slug = f"case-{abs(hash(name)) % 100000}"
    path = edit(slug, mutate)
    out = WORK / f"{slug}.json"
    try:
        convert(path, out)
    except ConvertError as exc:
        text = str(exc)
        if expect.lower() in text.lower():
            first = text.splitlines()[0]
            ok(f"{name}")
            print(f"    {DIM}{first[:110]}{RESET}")
            return True
        fail(f"{name}: упал, но не по той причине")
        print(f"    ожидалось вхождение «{expect}»")
        print(f"    получено: {text.splitlines()[0][:140]}")
        return False
    except Exception as exc:  # noqa: BLE001
        fail(f"{name}: упал необработанным {type(exc).__name__}: {exc}")
        return False

    fail(f"{name}: конвертер НЕ остановился — поломка прошла молча")
    return False


def main():
    WORK.mkdir(parents=True, exist_ok=True)

    head("Готовим эталонную книгу")
    build("demo", BASE)
    ok(f"{BASE.name}")

    head("Контрольный прогон: целая книга должна конвертироваться")
    baseline_ok = True
    try:
        payload = convert(BASE, WORK / "baseline.json")
        assert len(payload["days"]) == cfg.EXPECTED_DAYS
        assert len(payload["months"]) == cfg.EXPECTED_MONTHS
        ok(f"{len(payload['days'])} дней, {len(payload['months'])} месяцев, "
           f"{len(payload['moonEvents'])} фаз")
    except Exception as exc:  # noqa: BLE001
        fail(f"эталон не конвертируется: {exc}")
        baseline_ok = False

    head("Сломанные книги")
    results = [run_case(*case) for case in CASES]

    passed = sum(results)
    total = len(results)
    head("Итог")
    if baseline_ok and passed == total:
        ok(f"{BOLD}все проверки пройдены: {passed}/{total}{RESET}")
        return 0
    fail(f"пройдено {passed}/{total}" + ("" if baseline_ok else ", эталон сломан"))
    return 1


if __name__ == "__main__":
    sys.exit(main())

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
from client_config import ClientConfig, load_client
from console import BOLD, DIM, RESET, fail, head, info, ok
from make_reference_xlsx import build
from xlsx_to_calendar_json import ConvertError, convert, resolve_paths

WORK = ROOT / ".tmp" / "fixtures"
BASE = WORK / "base-demo.xlsx"

CLIENT = load_client(ROOT / "tests" / "fixtures" / "client-test.json")
ROWS = CLIENT.rows


def client_with(**over):
    """Конфиг того же клиента с одним изменённым полем.

    Нужен кейсам, где ломается не книга, а конфиг: конвертер обязан
    остановиться и на расхождении «таблица против конфига», иначе разница
    доехала бы до приложения молча.
    """
    data = {
        "range": {"start": CLIENT.range_start, "end": CLIENT.range_end},
        "rows": [dict(r) for r in ROWS],
        "extraMarks": dict(CLIENT.extra_marks),
    }
    data.update(over)
    return ClientConfig.from_dict(data)


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
    r2 = r1 + CLIENT.activity_row_count - 1
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
    r = top + cfg.OFFSET_FIRST_ACTIVITY + CLIENT.activity_row_count
    ws.cell(row=r, column=cfg.COL_LABEL).value = "Лишняя девятая строка"


def break_seven_activity_rows(wb, ws):
    top = find_title_row(ws, "ОКТЯБРЬ 2026")
    r = top + cfg.OFFSET_FIRST_ACTIVITY + CLIENT.activity_row_count - 1
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


def keep_intact(wb, ws):
    """Книга остаётся целой: в этих случаях расходится конфиг, а не таблица."""


def put_client_mark(wb, ws):
    """Буква, которой нет в общем каталоге, — законна только через extraMarks."""
    top = find_title_row(ws, "ИЮЛЬ 2027")
    ws.cell(row=top + cfg.OFFSET_FIRST_ACTIVITY, column=cfg.COL_FIRST_DAY + 5).value = "Ж"


# ---------------------------------------------------------------------------
# Реестр
# ---------------------------------------------------------------------------
# expect — фрагмент, который обязан встретиться в тексте ошибки. Проверяем
# не только факт падения, но и что оно указывает на настоящую причину.
#
# Четвёртый элемент, если он есть, — конфиг клиента для этого случая. Такие
# случаи проверяют не поломку книги, а расхождение книги с конфигом: конвертер
# обязан останавливаться и на нём.

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
    ("девять строк активностей",        break_nine_activity_rows,      "нашлась ещё одна"),
    ("семь строк активностей",          break_seven_activity_rows,     "подписи строк"),
    ("остатки справа от месяца",        break_leftover_right,          "справа от последнего дня"),
    ("переименованный лист",            break_sheet_renamed,           "не найден лист"),
    ("нечисло в строке дат",            break_dates_not_number,        "не число"),

    ("конфиг объявляет месяц, которого нет в книге",
     keep_intact, "набор месяцев не совпадает",
     lambda: client_with(range={"start": "2026-08-01", "end": "2027-09-30"})),
    ("конфиг объявляет строк больше, чем в книге",
     keep_intact, "подписи строк активностей",
     lambda: client_with(rows=ROWS + [{"id": "extra", "label": "Лишняя строка",
                                       "short": "Лишняя"}])),
    ("конфиг объявляет строк меньше, чем в книге",
     keep_intact, "нашлась ещё одна",
     lambda: client_with(rows=ROWS[:-1])),

    # Опоры луны снаружи диапазона: закрывают края, но обязаны сходиться
    # с таблицей, иначе диск на краю рисовался бы по выдуманной опоре.
    ("опора луны не чередуется с ближайшей фазой таблицы",
     keep_intact, "чередоваться",
     lambda: client_with(moonAnchors={
         "before": {"date": "2026-07-29", "type": "new"}})),
    ("опора луны слишком далеко от ближайшей фазы таблицы",
     keep_intact, "отстоит от ближайшей фазы",
     lambda: client_with(moonAnchors={
         "before": {"date": "2026-06-15", "type": "full"}})),
]

# Обратная сторона той же проверки: буква, объявленная клиентом в extraMarks,
# обязана ПРОХОДИТЬ. Иначе конфиг умел бы только запрещать.
ACCEPT_CASES = [
    ("буква из extraMarks принимается",
     put_client_mark,
     lambda: client_with(extraMarks={"Ж": "Тестовая буква этого клиента."})),
]


def check_moon_anchors_close_edges():
    """Опоры снаружи диапазона обязаны закрывать края календаря.

    Без них первые одиннадцать и последние четырнадцать дней остаются без
    фазы: интерполяции не на что опереться с одной стороны.
    """
    client = client_with(moonAnchors={
        "before": {"date": "2026-07-29", "type": "full"},
        "after": {"date": "2027-09-16", "type": "full"},
    })
    payload = convert(BASE, WORK / "anchored.json", client)
    dates = [e["date"] for e in payload["moonEvents"]]

    assert dates[0] == "2026-07-29", dates[:2]
    assert dates[-1] == "2027-09-16", dates[-2:]
    assert not payload["moonGaps"], payload["moonGaps"]

    # Каждый день диапазона теперь зажат между двумя опорами.
    first, last = client.range_start, client.range_end
    assert dates[0] < first, dates[0]
    assert dates[-1] > last, dates[-1]
    return len(dates)


# ---------------------------------------------------------------------------
# Запуск
# ---------------------------------------------------------------------------

def run_case(name, mutate, expect, make_client=None):
    slug = f"case-{abs(hash(name)) % 100000}"
    path = edit(slug, mutate)
    out = WORK / f"{slug}.json"
    client = make_client() if make_client else CLIENT
    try:
        convert(path, out, client)
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


def run_accept(name, mutate, make_client):
    """Случай наоборот: конвертер обязан ДОРАБОТАТЬ до конца."""
    slug = f"accept-{abs(hash(name)) % 100000}"
    path = edit(slug, mutate)
    out = WORK / f"{slug}.json"
    try:
        payload = convert(path, out, make_client())
    except Exception as exc:  # noqa: BLE001
        fail(f"{name}: конвертер остановился — {type(exc).__name__}: "
             f"{str(exc).splitlines()[0][:120]}")
        return False
    ok(f"{name}")
    print(f"    {DIM}{len(payload['days'])} дней записано{RESET}")
    return True


PATH_CASES = []


def path_case(name):
    def deco(fn):
        PATH_CASES.append((name, fn))
        return fn
    return deco


@path_case("номер клиента задаёт все три пути разом")
def _():
    xlsx, config, out = resolve_paths(ROOT, "03")
    assert xlsx == ROOT / "clients" / "03" / "calendar.xlsx", xlsx
    assert config == ROOT / "clients" / "03" / "client.json", config
    assert out == ROOT / "docs" / "03" / "data" / "calendar.json", out


@path_case("каждый путь можно перебить по отдельности")
def _():
    xlsx, config, out = resolve_paths(ROOT, "03", xlsx=".tmp/proba.xlsx")
    assert xlsx == Path(".tmp/proba.xlsx"), xlsx
    # Остальные два всё равно принадлежат клиенту 03.
    assert config == ROOT / "clients" / "03" / "client.json", config


@path_case("без номера и без явного конфига — ошибка")
def _():
    try:
        resolve_paths(ROOT, None)
    except ConvertError as exc:
        assert "номер клиента" in str(exc), exc
        return
    raise AssertionError("ожидалась ошибка про неуказанного клиента")


@path_case("тесты задают все пути явно и обходятся без номера")
def _():
    xlsx, config, out = resolve_paths(
        ROOT, None,
        xlsx="ref.xlsx", config="fixtures/client-test.json", out="build/c.json")
    assert (xlsx, config, out) == (
        Path("ref.xlsx"), Path("fixtures/client-test.json"), Path("build/c.json"))


@path_case("номер вместе с чужим конфигом — ошибка")
def _():
    try:
        resolve_paths(ROOT, "03", config="clients/01/client.json")
    except ConvertError as exc:
        assert "01" in str(exc) and "03" in str(exc), exc
        return
    raise AssertionError("ожидалась ошибка про несовпадение клиента")


def main():
    WORK.mkdir(parents=True, exist_ok=True)

    head("Готовим эталонную книгу")
    build(BASE, CLIENT, mode="demo")
    ok(f"{BASE.name}")

    head("Контрольный прогон: целая книга должна конвертироваться")
    baseline_ok = True
    try:
        payload = convert(BASE, WORK / "baseline.json", CLIENT)
        assert len(payload["days"]) == CLIENT.expected_days
        assert len(payload["months"]) == CLIENT.expected_months
        ok(f"{len(payload['days'])} дней, {len(payload['months'])} месяцев, "
           f"{len(payload['moonEvents'])} фаз")
    except Exception as exc:  # noqa: BLE001
        fail(f"эталон не конвертируется: {exc}")
        baseline_ok = False

    head("Сломанные книги")
    results = [run_case(*case) for case in CASES]

    head("Случаи, где конвертер обязан пропустить")
    results += [run_accept(*case) for case in ACCEPT_CASES]

    head("Пути клиента в CLI")
    for name, fn in PATH_CASES:
        try:
            fn()
            ok(name)
            results.append(True)
        except AssertionError as exc:
            fail(f"{name}: {exc}")
            results.append(False)

    head("Опоры луны закрывают края диапазона")
    try:
        total = check_moon_anchors_close_edges()
        ok(f"края закрыты, опор стало {total}")
        results.append(True)
    except Exception as exc:  # noqa: BLE001
        fail(f"опоры не закрыли края: {type(exc).__name__}: "
             f"{str(exc).splitlines()[0][:140]}")
        results.append(False)

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

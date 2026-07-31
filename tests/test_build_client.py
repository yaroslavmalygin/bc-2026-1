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


@case("негодный конфиг до публикации не доезжает")
def _():
    root = fresh_root()
    # Конец не последним днём месяца — конфиг обязан быть отвергнут здесь,
    # а не в приложении на телефоне.
    (root / "clients" / "07" / "client.json").write_text(json.dumps({
        "range": {"start": "2026-09-01", "end": "2027-09-15"},
        "rows": [{"id": "a", "label": "А", "short": "А"}],
    }, ensure_ascii=False), encoding="utf-8")
    try:
        build_client("07", root)
    except Exception as exc:
        assert "последний день" in str(exc), exc
        return
    raise AssertionError("ожидалась ошибка разбора конфига")


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

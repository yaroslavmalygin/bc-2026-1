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

sys.path.insert(0, str(Path(__file__).resolve().parent))
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

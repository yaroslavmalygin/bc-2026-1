"""
Русскоязычный вывод в консоль Windows.

По умолчанию stdout здесь в cp1252, и любая кириллица валит скрипт
UnicodeEncodeError уже на первом print. Импорт этого модуля переключает
поток в UTF-8 — вызывать ничего не нужно.
"""

import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass


GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def ok(msg):
    print(f"{GREEN}✓{RESET} {msg}")


def fail(msg):
    print(f"{RED}✗{RESET} {msg}")


def warn(msg):
    print(f"{YELLOW}!{RESET} {msg}")


def info(msg):
    print(f"  {msg}")


def head(msg):
    print(f"\n{BOLD}{msg}{RESET}")

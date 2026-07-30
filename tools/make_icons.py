"""
Генератор иконок приложения.

Рисунок — растущая луна: тот же образ, что и в лунной полосе приложения,
поэтому иконка на домашнем экране читается как «тот самый календарь».

Три размера с разным назначением:

  icon-192, icon-512        обычные иконки (purpose: any);
  icon-maskable-512         под Android-маску: система обрезает иконку кругом
                            или скруглённым квадратом, поэтому рисунок ужат
                            в безопасную зону — центральные 80 % холста, то
                            есть круг радиусом 40 % от стороны;
  apple-touch-icon 180×180  для iOS. Без него iOS ставит на домашний экран
                            скриншот страницы вместо иконки.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import console  # noqa: F401
from console import info, ok

BG = (19, 21, 32)        # тот же тёмный фон, что у приложения
MOON = (241, 238, 227)   # костяной, как --moon-lit в тёмной теме
RIM = (54, 58, 78)

SUPERSAMPLE = 4          # рисуем крупнее и уменьшаем — края выходят гладкими


def draw_moon(size, coverage):
    """Иконка со стороной size. coverage — доля холста под диск луны."""
    s = size * SUPERSAMPLE
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)

    r = s * coverage / 2
    cx = cy = s / 2

    # Полный диск
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=MOON)

    # Тень: круг того же радиуса, сдвинутый влево, оставляет растущий серп.
    shift = r * 0.42
    d.ellipse([cx - r - shift, cy - r, cx + r - shift, cy + r], fill=BG)

    # Тонкий контур, чтобы диск не сливался с фоном на светлых подложках
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RIM, width=max(1, s // 220))

    return img.resize((size, size), Image.LANCZOS)


def main():
    out = Path(__file__).resolve().parents[1] / "docs" / "icons"
    out.mkdir(parents=True, exist_ok=True)

    # Обычные иконки: луна занимает почти весь холст.
    for size in (192, 512):
        path = out / f"icon-{size}.png"
        draw_moon(size, 0.78).save(path, optimize=True)
        ok(f"{path.name}  {size}×{size}")

    # Maskable: рисунок обязан уложиться в круг радиусом 40 % стороны,
    # иначе система срежет края при обрезке под свою форму.
    path = out / "icon-maskable-512.png"
    draw_moon(512, 0.52).save(path, optimize=True)
    ok(f"{path.name}  512×512, безопасная зона соблюдена")

    path = out / "apple-touch-icon.png"
    draw_moon(180, 0.74).save(path, optimize=True)
    ok(f"{path.name}  180×180")

    info(f"каталог: {out}")


if __name__ == "__main__":
    main()

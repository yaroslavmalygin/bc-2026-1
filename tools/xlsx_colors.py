"""
Разрешение цвета заливки ячейки в честный шестизначный hex.

Отдельный модуль, потому что это самое коварное место всего конвертера.
openpyxl отдаёт цвет четырьмя разными способами, и только один из них —
готовый RGB. Остальные надо досчитывать:

  rgb      «FFB6D7A8» — берём как есть, отбросив альфу;
  theme    индекс цвета темы плюс tint; настоящий цвет лежит в theme1.xml
           внутри книги, а tint осветляет или затемняет его;
  indexed  индекс в устаревшей палитре Excel;
  auto     «автоматический» — трактуем как отсутствие заливки.

Если оставить обработку только для rgb, экспорт с темами прочитается как
«заливки нет», и календарь молча выйдет обесцвеченным.
"""

import colorsys
import re

from openpyxl.styles.colors import COLOR_INDEX

# Порядок цветов в theme1.xml: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink.
# В атрибуте theme= у ячейки первые две пары идут наоборот — это давняя
# особенность формата, а не опечатка.
_THEME_ORDER = ["dk1", "lt1", "dk2", "lt2",
                "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
                "hlink", "folHlink"]
_THEME_INDEX_SWAP = {0: 1, 1: 0, 2: 3, 3: 2}


class ThemeResolver:
    """Достаёт палитру темы из книги и превращает индекс с tint в hex."""

    def __init__(self, workbook):
        self.palette = self._parse(getattr(workbook, "loaded_theme", None))

    @staticmethod
    def _parse(theme_xml):
        if not theme_xml:
            return []
        if isinstance(theme_xml, bytes):
            theme_xml = theme_xml.decode("utf-8", errors="replace")

        scheme = re.search(r"<a:clrScheme.*?</a:clrScheme>", theme_xml, re.S)
        if not scheme:
            return []
        block = scheme.group(0)

        palette = []
        for name in _THEME_ORDER:
            node = re.search(rf"<a:{name}>(.*?)</a:{name}>", block, re.S)
            if not node:
                palette.append(None)
                continue
            body = node.group(1)
            srgb = re.search(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', body)
            if srgb:
                palette.append(srgb.group(1).upper())
                continue
            sysclr = re.search(r'<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"', body)
            palette.append(sysclr.group(1).upper() if sysclr else None)
        return palette

    def from_theme(self, index, tint):
        idx = _THEME_INDEX_SWAP.get(index, index)
        if idx is None or idx >= len(self.palette):
            return None
        base = self.palette[idx]
        if not base:
            return None
        return apply_tint(base, tint or 0.0)


def apply_tint(hex6, tint):
    """Осветление или затемнение по правилам OOXML.

    tint > 0 тянет цвет к белому, tint < 0 — к чёрному. Считается по
    светлоте в пространстве HLS, как это делает Excel.
    """
    if not tint:
        return hex6
    r, g, b = (int(hex6[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = l * (1 + tint) if tint < 0 else l * (1 - tint) + tint
    l = max(0.0, min(1.0, l))
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "".join(f"{round(v * 255):02X}" for v in (r, g, b))


def describe_fill(cell, resolver):
    """Возвращает (hex6 | None, вид_заливки) для ячейки.

    Второе значение нужно режиму --report-colors: по нему видно, каким
    именно способом задан цвет, и стоит ли ждать сюрпризов на реальном файле.
    """
    fill = cell.fill
    if fill is None or fill.fill_type in (None, "none"):
        return None, "none"

    color = fill.start_color
    if color is None:
        return None, "none"

    ctype = getattr(color, "type", None)

    if ctype == "rgb":
        raw = color.rgb
        if not isinstance(raw, str):
            return None, "rgb-empty"
        raw = raw.upper()
        hex6 = raw[-6:] if len(raw) >= 6 else None
        if hex6 == "000000" and fill.fill_type == "solid" and raw == "00000000":
            return None, "none"
        return hex6, "rgb"

    if ctype == "theme":
        hex6 = resolver.from_theme(getattr(color, "theme", None), getattr(color, "tint", 0.0))
        return hex6, "theme"

    if ctype == "indexed":
        idx = getattr(color, "indexed", None)
        if idx is None or idx >= len(COLOR_INDEX):
            return None, "indexed-unknown"
        raw = COLOR_INDEX[idx]
        return (raw[-6:].upper() if isinstance(raw, str) else None), "indexed"

    if ctype == "auto":
        return None, "auto"

    return None, f"unknown:{ctype}"

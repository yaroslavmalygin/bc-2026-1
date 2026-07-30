# Календарь

Персональный календарь на каждый день: открыл с иконки на телефоне — сразу
видно сегодняшний день по всем восьми строкам, свайп вбок листает соседние
дни. Работает офлайн, без App Store и без подписок.

Публичное приложение без персональных данных, исключённое из поисковой
индексации.

## Что внутри

```
docs/                 само приложение (его раздаёт GitHub Pages)
  index.html          каркас: шапка, лунная полоса, колода дней, шторки
  app.js              логика, крайние случаи, шторки, календарь
  dates.js            ВСЯ работа с датами — единственное разрешённое место
  store.js            хранилище данных и last-known-good
  validate.js         проверка calendar.json перед тем, как ему поверить
  moon.js             фаза луны: расчёт и отрисовка диска
  sw.js               service worker, кэширует ТОЛЬКО оболочку
  data/calendar.json  данные календаря

tools/                конвертер и утилиты
  xlsx_to_calendar_json.py   .xlsx → calendar.json со всеми проверками
  calendar_config.py         контракт с таблицей: раскладка, палитры, символы
  xlsx_colors.py             разрешение заливок, включая цвета темы
  make_reference_xlsx.py     эталонная книга для разработки и тестов
  make_icons.py              иконки приложения

tests/                проверки
  test_converter.py   16 намеренно сломанных книг
  test_dates.mjs      даты в 11 часовых поясах
  test_app.mjs        приложение в настоящем браузере

workflows/
  update_calendar_data.md    что делать, когда астролог сдал новый год
```

## Быстрый старт

```bash
pip install openpyxl pillow
npm install playwright && npx playwright install chromium

# эталонная книга и данные
python tools/make_reference_xlsx.py --mode demo
python tools/xlsx_to_calendar_json.py --xlsx .tmp/reference-demo.xlsx

# локальный запуск
python -m http.server 8000 --directory docs
```

## Тесты

```bash
python tests/test_converter.py
node   tests/test_dates.mjs --all-zones
node   tests/test_app.mjs
```

## Обновление данных

См. [workflows/update_calendar_data.md](workflows/update_calendar_data.md).

## Решения, которые легко случайно сломать

**`calendar.json` не проходит через service worker.** Попади он под обычный
обработчик воркера, тот сохранил бы сетевой ответ раньше, чем приложение его
проверит, и повреждённый файл осел бы в кэше как рабочий. Данными
распоряжается только приложение.

**Даты — только через `dates.js`.** `new Date("2026-08-12")` парсится как
UTC-полночь, `toISOString()` уводит день в другом часовом поясе, а
прибавление 86 400 000 мс ломается на переходах летнего времени.

**Строки таблицы опознаются по позиции, а не по названию.** В исходнике
подписи одной и той же строки различаются от месяца к месяцу.

**`dataHash` и `APP_CACHE_VERSION` — разные вещи.** Первый версионирует
данные и считается сам, второй — оболочку и меняется руками.

**`robots.txt` разрешает обход намеренно.** Из поиска страница выпадает
мета-тегом `noindex`; запрет обхода помешал бы краулеру этот тег прочитать.

## Шрифт

Cormorant Garamond, сабсеты latin и cyrillic, зашиты в `docs/fonts.css`
в base64 — приложение обязано работать офлайн. Лицензия SIL Open Font
License 1.1, см. `docs/OFL.txt`.

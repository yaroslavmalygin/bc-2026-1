# Календарь

Персональный календарь на каждый день: открыл с иконки на телефоне — сразу
видно сегодняшний день по всем строкам активностей, свайп вбок листает
соседние дни. Работает офлайн, без App Store и без подписок.

Клиентов может быть много, у каждого своя ссылка `…github.io/bc/NN/` и своя
папка. Новый клиент заводится одной командой, без копирования проекта.

Публичное приложение без персональных данных, исключённое из поисковой
индексации.

## Что внутри

```
app/                  ИСХОДНИК оболочки — единственное место, где её правят
  index.html          каркас: шапка, лунная полоса, колода дней, шторки
  app.js              логика, крайние случаи, шторки, календарь
  dates.js            ВСЯ работа с датами — единственное разрешённое место
  client-id.js        идентификатор клиента из адреса скрипта
  store.js            хранилище данных и last-known-good
  validate.js         проверка calendar.json перед тем, как ему поверить
  moon.js             фаза луны: расчёт и отрисовка диска
  sw.js               service worker, кэширует ТОЛЬКО оболочку

clients/NN/
  client.json         что различается у клиента: диапазон, строки, символы
  calendar.xlsx       таблица астролога (под .gitignore)

docs/                 СБОРКА, её раздаёт GitHub Pages — руками не правят
  NN/                 копия оболочки плюс data/calendar.json клиента

tools/
  build_client.py            app/ → docs/NN/, данные не трогает
  client_config.py           чтение и проверка client.json
  xlsx_to_calendar_json.py   .xlsx → calendar.json со всеми проверками
  calendar_config.py         контракт с таблицей: раскладка, палитры, символы
  xlsx_colors.py             разрешение заливок, включая цвета темы
  make_reference_xlsx.py     эталонная книга для разработки и тестов
  make_icons.py              иконки приложения

tests/                проверки
  test_client_config.py  конфиг клиента
  test_build_client.py   генератор сборок
  test_converter.py      19 намеренно сломанных книг
  test_dates.mjs         даты в 11 часовых поясах
  test_client_id.mjs     вывод идентификатора из адреса
  test_app.mjs           приложение в настоящем браузере
  test_clients.mjs       изоляция двух клиентов в одном браузере
  test_live.mjs          опубликованный сайт

workflows/
  add_client.md              как завести нового клиента
  update_calendar_data.md    что делать, когда астролог сдал новый год
```

## Быстрый старт

```bash
pip install openpyxl pillow
npm install playwright && npx playwright install chromium

# эталонная книга, оболочка и данные клиента 01
python tools/make_reference_xlsx.py --mode demo \
       --client clients/01/client.json --out .tmp/reference-demo.xlsx
python tools/build_client.py 01
python tools/xlsx_to_calendar_json.py --xlsx .tmp/reference-demo.xlsx \
       --client clients/01/client.json --out docs/01/data/calendar.json

# локальный запуск
python -m http.server 8000 --directory docs   # http://127.0.0.1:8000/01/
```

## Тесты

```bash
python tests/test_client_config.py
python tests/test_build_client.py
python tests/test_converter.py
node   tests/test_dates.mjs --all-zones
node   tests/test_client_id.mjs
node   tests/test_app.mjs
node   tests/test_clients.mjs
```

## Новый клиент

См. [workflows/add_client.md](workflows/add_client.md).

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

**Хранилище делится по origin, а не по пути.** Все клиенты живут на одном
домене, поэтому имя базы и префикс кэша содержат идентификатор клиента,
выведенный из адреса скрипта. Иначе два календаря на одном телефоне писали
бы в одну базу, а обновление одного сносило бы офлайн-оболочку другого.

**`docs/` — результат сборки.** Правится `app/`, дальше
`python tools/build_client.py --all`. Правка прямо в `docs/NN/` живёт до
первой пересборки.

## Шрифт

Cormorant Garamond, сабсеты latin и cyrillic, зашиты в `app/fonts.css`
в base64 — приложение обязано работать офлайн. Лицензия SIL Open Font
License 1.1, см. `app/OFL.txt`.

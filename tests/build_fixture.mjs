/**
 * Готовит настоящую клиентскую сборку для браузерных тестов.
 *
 * Раньше тесты поднимали сервер над docs/ с боевыми данными. Теперь docs/ —
 * результат сборки, и зависеть от того, заведён ли живой клиент, тестам
 * незачем. Собираем во временный каталог из эталонной книги.
 *
 * Сервер поднимается над РОДИТЕЛЬСКИМ каталогом, а клиент лежит в подпапке:
 * иначе сегмент пути пуст, идентификатор становится «local» и изоляцию
 * не проверить по-настоящему.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SANDBOX = resolve(ROOT, ".tmp", "fixture-root");
const BUILD = resolve(SANDBOX, "docs");
const FIXTURE = resolve(ROOT, "tests", "fixtures", "client-test.json");
const REF_XLSX = resolve(ROOT, ".tmp", "reference-demo.xlsx");

const PYTHON = process.platform === "win32" ? "python" : "python3";

/**
 * Рекурсивная копия своими руками.
 *
 * fs.cpSync({recursive:true}) на этой связке Node + Windows роняет процесс
 * целиком (STATUS_STACK_BUFFER_OVERRUN), причём без единой строки вывода —
 * тест выглядел бы просто «упал молча». Ручной обход десять строк и не
 * зависит от версии Node.
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = resolve(from, entry.name);
    const dst = resolve(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else copyFileSync(src, dst);
  }
}

function run(args) {
  const res = spawnSync(PYTHON, args, { cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`python ${args.join(" ")} упал:\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout;
}

export async function buildFixture(ids) {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(SANDBOX, { recursive: true });

  // Оболочку берём ту же, что уедет клиентам: генератор ждёт app/ рядом
  // с clients/, поэтому песочница повторяет раскладку репозитория.
  copyTree(resolve(ROOT, "app"), resolve(SANDBOX, "app"));

  run(["tools/make_reference_xlsx.py", "--mode", "demo",
       "--client", FIXTURE, "--out", REF_XLSX]);

  for (const id of ids) {
    const clientDir = resolve(SANDBOX, "clients", id);
    mkdirSync(clientDir, { recursive: true });
    copyFileSync(FIXTURE, resolve(clientDir, "client.json"));

    run(["tools/build_client.py", id, "--root", SANDBOX]);
    run(["tools/xlsx_to_calendar_json.py",
         "--xlsx", REF_XLSX,
         "--client", FIXTURE,
         "--out", resolve(BUILD, id, "data", "calendar.json")]);
  }

  return BUILD;
}

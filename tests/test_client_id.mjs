/**
 * Идентификатор клиента выводится из адреса скрипта.
 *
 * Cache Storage и IndexedDB делятся по origin, а не по пути: все клиенты
 * на username.github.io живут в одном хранилище. Идентификатор разводит
 * их по папкам, и ошибка здесь означала бы чужие данные офлайн — молча.
 *
 * Запуск:  node tests/test_client_id.mjs
 */

import { clientIdFrom } from "../app/client-id.js";

let failed = 0;
function check(name, got, want) {
  if (got === want) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}: получено «${got}», ожидалось «${want}»`);
    failed++;
  }
}

check("боевой адрес клиента",
  clientIdFrom("https://yaroslavmalygin.github.io/bc/01/sw.js"), "01");
check("другой клиент",
  clientIdFrom("https://yaroslavmalygin.github.io/bc/02/store.js"), "02");
check("вложенный модуль берёт папку скрипта",
  clientIdFrom("https://yaroslavmalygin.github.io/bc/07/client-id.js"), "07");
check("локальный сервер над корнем — не пустая строка",
  clientIdFrom("http://127.0.0.1:8123/sw.js"), "local");
check("сервер над сборкой, клиент в подпапке",
  clientIdFrom("http://127.0.0.1:8123/a/sw.js"), "a");
check("хвостовой слэш не создаёт пустой сегмент",
  clientIdFrom("https://example.com/bc/01/"), "01");
check("query и hash не влияют",
  clientIdFrom("https://example.com/bc/01/sw.js?v=2#x"), "01");

console.log(failed ? `\n${failed} проверок упало` : "\n7/7 проверок прошло");
process.exit(failed ? 1 : 0);

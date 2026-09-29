// Copia o app web (../../copiloto) para nativo/www, que e o que o Capacitor
// empacota no APK. www/ nao vai para o git: e sempre derivado.
//
// O service worker fica de fora de proposito. Dentro do APK os arquivos ja
// estao no aparelho, entao um cache-first so criaria a chance de servir
// arquivo velho depois de atualizar o app -- o mesmo bug que a versao do
// cache resolve na web, mas aqui sem nada para resolver.
import { cp, rm, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const origem = join(aqui, "..", "..", "copiloto");
const destino = join(aqui, "..", "www");

const FORA = new Set([
  "sw.js",
  "test",
  "README.md",
  "FUNCIONALIDADES.md",
  "FUNCIONALIDADES.txt",
]);

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });

for (const nome of await readdir(origem)) {
  if (FORA.has(nome)) continue;
  await cp(join(origem, nome), join(destino, nome), { recursive: true });
}

const copiados = await readdir(destino);
console.log(`www/ montado a partir de copiloto/ (${copiados.length} entradas)`);

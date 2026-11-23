// db.js — IndexedDB. Tudo e gravado aqui primeiro; o servidor e copia. Sem
// sinal no local, nada se perde e nenhuma etapa deixa de ser registrada.

const DB_NAME = "soswf-os";
const DB_VERSION = 1;

const STORES = {
  os: { keyPath: "id", indexes: [["criadaEm", "criadaEm"]] },
  // { id, osId, blob, ts, gps, enviada }
  fotos: { keyPath: "id", indexes: [["osId", "osId"]] },
  config: { keyPath: "chave" },
};

let dbPromise = null;

export function novoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function abrir() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [nome, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(nome)) continue;
        const s = db.createObjectStore(nome, { keyPath: def.keyPath });
        for (const [i, campo] of def.indexes || []) s.createIndex(i, campo, { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, modo, fn) {
  return abrir().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, modo);
        const req = fn(t.objectStore(store));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export const db = {
  put: (s, v) => tx(s, "readwrite", (o) => o.put(v)),
  get: (s, k) => tx(s, "readonly", (o) => o.get(k)),
  todos: (s) => tx(s, "readonly", (o) => o.getAll()),
  remover: (s, k) => tx(s, "readwrite", (o) => o.delete(k)),
  porIndice: (s, i, v) => tx(s, "readonly", (o) => o.index(i).getAll(v)),
};

export async function lerConfig(chave, padrao) {
  const r = await db.get("config", chave);
  return r ? r.valor : padrao;
}

export function gravarConfig(chave, valor) {
  return db.put("config", { chave, valor });
}

/** Pede ao navegador para nao apagar os dados quando faltar espaco. */
export async function pedirPersistencia() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}

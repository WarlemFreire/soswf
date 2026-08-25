// db.js — camada de persistencia sobre IndexedDB.
// Sem dependencias externas: o app precisa funcionar 100% offline e o repo
// nao tem build step, entao nada de CDN.

const DB_NAME = "copiloto";
const DB_VERSION = 1;

// Stores das fases seguintes (custos, corridas, contextos) ja nascem aqui para
// evitar uma migracao de schema quando a Fase 2 chegar.
const STORES = {
  jornadas: { keyPath: "id", indexes: [["data", "data"], ["status", "status"]] },
  registros: { keyPath: "id", indexes: [["jornadaId", "jornadaId"], ["timestamp", "timestamp"]] },
  pausas: { keyPath: "id", indexes: [["jornadaId", "jornadaId"]] },
  custos: { keyPath: "id", indexes: [["jornadaId", "jornadaId"], ["timestamp", "timestamp"]] },
  corridas: { keyPath: "id", indexes: [["jornadaId", "jornadaId"], ["timestamp", "timestamp"]] },
  contextos: { keyPath: "id", indexes: [["jornadaId", "jornadaId"], ["timestamp", "timestamp"]] },
  config: { keyPath: "chave" },
};

export const NOMES_STORES = Object.keys(STORES);

let dbPromise = null;

export function novoId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
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
        const store = db.createObjectStore(nome, { keyPath: def.keyPath });
        for (const [indice, campo] of def.indexes || []) {
          store.createIndex(indice, campo, { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function transacionar(store, modo, fn) {
  return abrir().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, modo);
        const req = fn(tx.objectStore(store));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        if (req) {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } else {
          tx.oncomplete = () => resolve();
        }
      })
  );
}

export const db = {
  put: (store, valor) => transacionar(store, "readwrite", (s) => s.put(valor)),
  get: (store, chave) => transacionar(store, "readonly", (s) => s.get(chave)),
  todos: (store) => transacionar(store, "readonly", (s) => s.getAll()),
  remover: (store, chave) => transacionar(store, "readwrite", (s) => s.delete(chave)),
  limpar: (store) => transacionar(store, "readwrite", (s) => s.clear()),

  porIndice: (store, indice, valor) =>
    transacionar(store, "readonly", (s) => s.index(indice).getAll(valor)),

  async putVarios(store, valores) {
    const conexao = await abrir();
    return new Promise((resolve, reject) => {
      const tx = conexao.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      for (const v of valores) os.put(v);
      tx.oncomplete = () => resolve(valores.length);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  async despejarTudo() {
    const saida = {};
    for (const nome of NOMES_STORES) saida[nome] = await db.todos(nome);
    return saida;
  },
};

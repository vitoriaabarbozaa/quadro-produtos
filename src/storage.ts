import {
  addDoc, collection, doc, getDoc, setDoc, onSnapshot,
  query, where, documentId, orderBy, limit,
  deleteDoc, getDocs, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { buildSchedule, type Product, type DaySchedule } from "./data";
import { toMinutes } from "./hooks";

const COLLECTION = "schedule";

function sortByStart(products: Product[]): Product[] {
  return [...products].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}

/** Remove chaves com valor `undefined` — o Firestore rejeita documentos que as contenham. */
function stripUndefined<T extends object>(obj: T): T {
  const clone = { ...obj } as Record<string, unknown>;
  Object.keys(clone).forEach(k => {
    if (clone[k] === undefined) delete clone[k];
  });
  return clone as T;
}

function seedFromTemplate(date: string, weekDates: string[]): Product[] {
  const templateWeek = buildSchedule(weekDates);
  const day = templateWeek.find(d => d.date === date);
  return (day?.products ?? []).map((p, i) => stripUndefined({ ...p, id: `${date}-t${i}` }));
}

/** Garante que o documento do dia existe no Firestore (semeando com o modelo padrão, se preciso). */
async function ensureDay(date: string, weekDatesHint?: string[]): Promise<Product[]> {
  const ref = doc(db, COLLECTION, date);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return (snap.data().products ?? []) as Product[];
  }
  const seeded = weekDatesHint ? seedFromTemplate(date, weekDatesHint) : [];
  await setDoc(ref, { products: seeded });
  return seeded;
}

/**
 * Assina a programação de uma semana em tempo real. Chama `callback` sempre
 * que algo mudar (na hora, em qualquer dispositivo). Retorna uma função pra
 * cancelar a assinatura (chame no cleanup do useEffect).
 */
export function subscribeToSchedule(
  weekDates: string[],
  callback: (schedule: DaySchedule[]) => void,
): () => void {
  const current = new Map<string, Product[]>();
  let cancelled = false;

  function emit() {
    if (cancelled) return;
    callback(weekDates.map(date => ({ date, products: current.get(date) ?? [] })));
  }

  // Garante que todos os dias da semana existem (semeados), sem travar a
  // primeira renderização — os listeners abaixo já vão receber os dados.
  weekDates.forEach(date => { void ensureDay(date, weekDates); });

  const q = query(collection(db, COLLECTION), where(documentId(), "in", weekDates));
  const unsubscribe = onSnapshot(q, snap => {
    snap.forEach(docSnap => {
      current.set(docSnap.id, sortByStart((docSnap.data().products ?? []) as Product[]));
    });
    emit();
  }, err => {
    console.error("Erro ao sincronizar programação:", err);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/** Leitura pontual (sem assinatura), útil pra operações de escrita. */
async function getDay(date: string, weekDatesHint?: string[]): Promise<Product[]> {
  return ensureDay(date, weekDatesHint);
}

export async function addProduct(date: string, product: Omit<Product, "id">, weekDatesHint?: string[]): Promise<Product> {
  const products = await getDay(date, weekDatesHint);
  const newProduct: Product = stripUndefined({ ...product, id: `${date}-c${Date.now()}` });
  const updated = sortByStart([...products, newProduct]).map(stripUndefined);
  await setDoc(doc(db, COLLECTION, date), { products: updated });
  return newProduct;
}

export async function updateProduct(date: string, id: string, updated: Omit<Product, "id">, weekDatesHint?: string[]): Promise<void> {
  const products = await getDay(date, weekDatesHint);
  const next = sortByStart(products.map(p => (p.id === id ? { ...updated, id } : p))).map(stripUndefined);
  await setDoc(doc(db, COLLECTION, date), { products: next });
}

export async function deleteProduct(date: string, id: string): Promise<void> {
  const ref = doc(db, COLLECTION, date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const products = ((snap.data().products ?? []) as Product[]).filter(p => p.id !== id);
  await setDoc(ref, { products });
}


// ── Histórico de alterações ───────────────────────────────────────────────────
export type EditLogAction = "created" | "updated" | "deleted";

export interface EditLogEntry {
  id?: string;
  actor: string;
  action: EditLogAction;
  date: string;
  productName: string;
  details: string;
  createdAt: string;
}

const EDIT_LOG_COLLECTION = "editLogs";

/** Grava no Firestore para que o histórico seja compartilhado entre dispositivos. */
export async function recordEditLog(entry: Omit<EditLogEntry, "id">): Promise<void> {
  await addDoc(collection(db, EDIT_LOG_COLLECTION), entry);
}

/** Apaga um registro do histórico (uso do Super Admin). */
export async function deleteEditLogEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, EDIT_LOG_COLLECTION, id));
}

/** Apaga TODO o histórico, inclusive registros além dos 100 exibidos (uso do Super Admin). */
export async function clearEditLog(): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await getDocs(query(collection(db, EDIT_LOG_COLLECTION), limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
  return total;
}

/** Escuta os 100 registros mais recentes do histórico. */
export function subscribeToEditLog(
  callback: (entries: EditLogEntry[]) => void,
  onError?: (message: string) => void,
): () => void {
  const q = query(collection(db, EDIT_LOG_COLLECTION), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(q, snapshot => {
    callback(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as EditLogEntry)));
  }, error => {
    console.error("Erro ao carregar histórico de edições:", error);
    onError?.(error.code === "permission-denied"
      ? "O Firebase está bloqueando a leitura do histórico. Publique as regras que permitem leitura da coleção editLogs."
      : `Não foi possível carregar o histórico: ${error.message}`);
  });
}

// ── Roster ────────────────────────────────────────────────────────────────────
// Funções (papéis) e pessoas pré-cadastradas para montar a equipe de cada
// produto. O admin pode usar as sugestões abaixo (extraídas da programação
// atual) ou cadastrar nomes/funções novas na hora — o que for adicionado fica
// salvo no navegador para as próximas vezes.

export type ProductKindKey =
  | "BDPE" | "NE1" | "GE" | "BOLETIM" | "NE2" | "JOGO" | "GCO" | "DESCOMPLICA" | "EVENTO";

export interface ProductKind {
  key: ProductKindKey;
  label: string;
  type: "programa" | "jogo";
  defaultStudio: string;
  /** Horário padrão ao escolher o produto no formulário (opcional). */
  defaultStart?: string;
  defaultEnd?: string;
}

export const PRODUCT_KINDS: ProductKind[] = [
  { key: "BDPE",        label: "Bom Dia PE",      type: "programa", defaultStudio: "Estúdio 1", defaultStart: "06:00", defaultEnd: "08:30" },
  { key: "NE1",         label: "NE1",             type: "programa", defaultStudio: "Estúdio 1", defaultStart: "11:45", defaultEnd: "13:00" },
  { key: "GE",          label: "Globo Esporte PE", type: "programa", defaultStudio: "Estúdio 1", defaultStart: "13:00", defaultEnd: "13:30" },
  { key: "BOLETIM",     label: "Boletim",         type: "programa", defaultStudio: "Estúdio 1", defaultStart: "17:00", defaultEnd: "17:10" },
  { key: "NE2",         label: "NE2",             type: "programa", defaultStudio: "Estúdio 1", defaultStart: "19:00", defaultEnd: "19:30" },
  { key: "JOGO",        label: "Jogo",            type: "jogo",     defaultStudio: "" },
  { key: "GCO",         label: "GCO",             type: "programa", defaultStudio: "Estúdio 1" },
  { key: "DESCOMPLICA", label: "Descomplica PE",  type: "programa", defaultStudio: "Estúdio Descomplica" },
  { key: "EVENTO",      label: "Evento",          type: "programa", defaultStudio: "" },
];

// Funções sugeridas por tipo de produto (o admin pode adicionar outras na hora).
// Programas de rotina e eventos só precisam do(a) apresentador(a); jogos
// precisam de narração, comentário e equipe ao vivo em campo.
export const ROLE_PRESETS: Record<ProductKindKey, string[]> = {
  BDPE:        ["Apresentador(a)"],
  NE1:         ["Apresentador(a)"],
  GE:          ["Apresentador(a)"],
  BOLETIM:     ["Apresentador(a)"],
  NE2:         ["Apresentador(a)"],
  JOGO:        ["Narrador", "Comentarista", "Ao vivo em campo"],
  GCO:         ["Apresentador(a)"],
  DESCOMPLICA: ["Apresentador(a)"],
  EVENTO:      ["Apresentador(a)"],
};

// Pessoas pré-cadastradas, já separadas por função (serve de ponto de partida
// para os checkboxes — são nomes de exemplo, ajuste à vontade).
export const PEOPLE_BY_CATEGORY: Record<string, string[]> = {
  "Apresentador(a)":  ["Clarissa Góes","Bruno Fontes", "Maristela Niz", "Giuliano Roque", "Márcio Bonfim", "Sabrina Rocha", "Tiago Medeiros"],
  "Narrador":         ["Rembrandt Júnior"],
  "Comentarista":     ["Cabral Neto", "Danny Morais"],
  "Ao vivo em campo": ["Sarah Porto", "Diogo Marques", "Juan Torres", "Lílian Fonseca"],
};

// Mapeia variações de nome de função (como aparecem em ROLE_PRESETS) para a
// categoria de pessoas correspondente em PEOPLE_BY_CATEGORY. Funções que não
// estiverem aqui viram sua própria categoria (útil para funções customizadas
// que o admin cadastrar na hora).
const ROLE_TO_CATEGORY: Record<string, string> = {
  "Apresentador":     "Apresentador(a)",
  "Apresentadora":    "Apresentador(a)",
  "Apresentador(a)":  "Apresentador(a)",
  "Narrador":         "Narrador",
  "Comentarista":     "Comentarista",
  "Ao vivo em campo": "Ao vivo em campo",
};

/** Categoria de pessoas correspondente a uma função. */
export function categoryForRole(role: string): string {
  return ROLE_TO_CATEGORY[role] ?? role;
}

const PEOPLE_KEY = "qp_roster_people";
const ROLES_KEY  = "qp_roster_extra_roles";
const REMOVED_PEOPLE_KEY = "qp_roster_removed_people";

function loadList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Pessoas sugeridas para uma função específica (padrão da categoria + extras cadastradas). */
export function getPeopleForRole(role: string): string[] {
  const category = categoryForRole(role);
  const base  = PEOPLE_BY_CATEGORY[category] ?? [];
  const extra = loadList(`${PEOPLE_KEY}_${category}`);
  const removed = loadList(REMOVED_PEOPLE_KEY);
  return Array.from(new Set([...base, ...extra]))
    .filter(name => !removed.includes(`${category}::${name}`))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Remove uma pessoa da lista de sugestões sem apagar seu histórico de produtos. */
export function removePerson(role: string, name: string) {
  const category = categoryForRole(role);
  const key = `${category}::${name.trim()}`;
  if (!name.trim()) return;
  const removed = loadList(REMOVED_PEOPLE_KEY);
  if (!removed.includes(key)) saveList(REMOVED_PEOPLE_KEY, [...removed, key]);
}

/** Cadastra uma pessoa nova ou restaura uma pessoa removida (idempotente). */
export function addPerson(role: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const category = categoryForRole(role);
  const removedKey = `${category}::${trimmed}`;
  saveList(REMOVED_PEOPLE_KEY, loadList(REMOVED_PEOPLE_KEY).filter(item => item !== removedKey));
  const key = `${PEOPLE_KEY}_${category}`;
  const extra = loadList(key);
  if (!(PEOPLE_BY_CATEGORY[category] ?? []).includes(trimmed) && !extra.includes(trimmed)) {
    saveList(key, [...extra, trimmed]);
  }
}

/** Todas as pessoas conhecidas, de todas as categorias juntas. */
export function getAllPeople(): string[] {
  const all = Object.keys(PEOPLE_BY_CATEGORY).flatMap(getPeopleForRole);
  return Array.from(new Set(all)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Todas as funções conhecidas para um tipo de produto (padrão + extras cadastradas). */
export function getRolesFor(kind: ProductKindKey): string[] {
  const extraKey = `${ROLES_KEY}_${kind}`;
  const extra = loadList(extraKey);
  return Array.from(new Set([...ROLE_PRESETS[kind], ...extra]));
}

/** Cadastra uma função nova para um tipo de produto (idempotente). */
export function addRole(kind: ProductKindKey, role: string) {
  const trimmed = role.trim();
  if (!trimmed) return;
  const extraKey = `${ROLES_KEY}_${kind}`;
  const extra = loadList(extraKey);
  if (!getRolesFor(kind).includes(trimmed)) {
    saveList(extraKey, [...extra, trimmed]);
  }
}

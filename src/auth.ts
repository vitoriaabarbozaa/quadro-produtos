// ── Autenticação ──────────────────────────────────────────────────────────────
// Autenticação simples, só de front-end (sem servidor). Serve para liberar a
// edição do quadro apenas para quem tem a senha — não é uma segurança "à prova
// de bala", mas é suficiente para controlar quem mexe na programação.

export interface Account {
  /** Nome do setor/conta, só para referência. */
  label: string;
  /** Senha de acesso. */
  password: string;
  /** "admin" pode criar/editar/excluir produtos. */
  role: "admin";
}

/** Papéis possíveis de quem está logado. "super" = admin + apagar histórico. */
export type Role = "admin" | "super";

// Contas cadastradas. Por enquanto só existe o admin (Jornalismo), que edita
// o quadro inteiro. Quando souber o nome oficial do setor e quiser trocar a
// senha, é só editar a linha abaixo.
//
// Para adicionar um novo setor com acesso de admin no futuro (ex.: COT),
// basta incluir outra linha, por exemplo:
//   { label: "COT", password: "globocot", role: "admin" },
export const ACCOUNTS: Account[] = [
  { label: "Admin", password: "admin", role: "admin" },
];

// ── Usuário Super Admin ───────────────────────────────────────────────────────
// Faz tudo que o admin faz e ainda pode APAGAR o histórico de alterações.
// Entra pelo mesmo "Modo Admin": no campo "Seu nome" vai o usuário abaixo, e no
// campo "Senha" a senha. A senha NÃO fica escrita aqui, só o "hash" dela
// (PBKDF2-SHA256), então quem lê o código não descobre a senha.
// Para trocar o usuário, edite SUPER_USERNAME. Para trocar a senha, gere um hash
// novo (veja o README) e cole em SUPER_PASSWORD_HASH.
const SUPER_USERNAME = "jjeonasa";
const SUPER_SALT = "quadro-produtos:super:v1";
const SUPER_ITERATIONS = 210_000;
const SUPER_PASSWORD_HASH = "2b0848ca0cd15faa795f8c314df9b3c9bddca55d2f29bb0878ca4a8f1066171f";

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(SUPER_SALT), iterations: SUPER_ITERATIONS },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_KEY = "qp_admin_session";

export interface AdminSession {
  name: string;
  label: string;
  role: Role;
}

/** Confere a senha digitada contra as contas cadastradas. */
export function checkPassword(password: string): Account | null {
  const found = ACCOUNTS.find(a => a.password === password);
  return found ?? null;
}

/**
 * Tenta logar. Para admins comuns, `name` é só o nome de quem está usando
 * (exibido na tela), livre. O nome do Super Admin é reservado: só entra com ele
 * quem souber a senha do Super Admin.
 */
export async function login(name: string, password: string): Promise<AdminSession | null> {
  const trimmedName = name.trim();
  if (!trimmedName) return null;

  let session: AdminSession | null = null;
  if (trimmedName.toLowerCase() === SUPER_USERNAME) {
    if ((await hashPassword(password)) === SUPER_PASSWORD_HASH) {
      session = { name: SUPER_USERNAME, label: "Super Admin", role: "super" };
    }
  } else {
    const account = checkPassword(password.trim());
    if (account) session = { name: trimmedName, label: account.label, role: "admin" };
  }
  if (!session) return null;

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage indisponível — segue logado só nesta sessão de memória
  }
  return session;
}

export function logout() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function getSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Sessões antigas não têm "role": tratam-se como admin comum.
    return { name: parsed.name, label: parsed.label, role: parsed.role === "super" ? "super" : "admin" };
  } catch {
    return null;
  }
}

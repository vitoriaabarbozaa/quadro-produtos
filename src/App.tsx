import { useState, useMemo, useEffect, useLayoutEffect } from "react";
import {
  getWeekDates, PRODUCT_COLORS,
  type Product, type DaySchedule, type Status, type TeamMember,
} from "./data";
import { useRecifeTime, formatTime, toMinutes, currentMinutes, countdown } from "./hooks";
import { login, logout, getSession, type AdminSession } from "./auth";
import {
  PRODUCT_KINDS, getRolesFor, getPeopleForRole, addPerson, removePerson, addRole,
  type ProductKindKey,
} from "./roster";
import {
  subscribeToSchedule, addProduct, updateProduct, deleteProduct,
  recordEditLog, subscribeToEditLog, deleteEditLogEntry, clearEditLog, type EditLogEntry,
} from "./storage";

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Status, string> = {
  confirmado: "Confirmado",
  previsto:   "Previsto",
  alterado:   "Alterado",
  cancelado:  "Cancelado",
};

// As cores reais ficam em src/index.css (variáveis --st-*), com valores diferentes no modo noturno.
const STATUS_COLORS: Record<Status, { bg: string; text: string; border: string }> = {
  confirmado: { bg: "var(--st-confirmado-bg)", text: "var(--st-confirmado-text)", border: "var(--st-confirmado-border)" },
  previsto:   { bg: "var(--st-previsto-bg)",   text: "var(--st-previsto-text)",   border: "var(--st-previsto-border)" },
  alterado:   { bg: "var(--st-alterado-bg)",   text: "var(--st-alterado-text)",   border: "var(--st-alterado-border)" },
  cancelado:  { bg: "var(--st-cancelado-bg)",  text: "var(--st-cancelado-text)",  border: "var(--st-cancelado-border)" },
};

const DAY_LABELS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];
const DAY_FULL   = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira",
                    "Sexta-feira", "Sábado", "Domingo"];

type Shift = "todos" | "manha" | "tarde" | "noite";

const SHIFTS: { key: Shift; label: string; range: string; start: number; end: number }[] = [
  { key: "todos",  label: "Todos",  range: "",          start: 0,   end: 24 * 60 },
  { key: "manha",  label: "Manhã",  range: "05h – 11h", start: 5 * 60,  end: 11 * 60 },
  { key: "tarde",  label: "Tarde",  range: "11h – 17h", start: 11 * 60, end: 17 * 60 },
  { key: "noite",  label: "Noite",  range: "17h – 23h", start: 17 * 60, end: 23 * 60 },
];

function productInShift(p: Product, shift: Shift): boolean {
  if (shift === "todos") return true;
  const cfg = SHIFTS.find(s => s.key === shift)!;
  const start = toMinutes(p.startTime);
  const end   = toMinutes(p.endTime);
  // include if the product overlaps with the shift window
  return start < cfg.end && end > cfg.start;
}

function currentShift(nowMin: number): Shift {
  if (nowMin >= 5 * 60  && nowMin < 11 * 60) return "manha";
  if (nowMin >= 11 * 60 && nowMin < 17 * 60) return "tarde";
  if (nowMin >= 17 * 60 && nowMin < 23 * 60) return "noite";
  return "todos";
}

function productColor(shortName: string) {
  return PRODUCT_COLORS[shortName] ?? "#6b7280";
}

function getState(p: Product, dateStr: string, todayStr: string, nowMin: number) {
  if (dateStr !== todayStr) return dateStr < todayStr ? "done" : "future";
  const s = toMinutes(p.startTime), e = toMinutes(p.endTime);
  if (nowMin >= s && nowMin < e) return "on-air";
  if (nowMin < s) return "upcoming";
  return "done";
}

function talentNames(p: Product): string[] {
  if (p.type === "jogo") {
    return p.team
      .filter(m => ["Narrador", "Comentarista"].some(r => m.role.startsWith(r)))
      .map(m => m.name);
  }
  return p.team
    .filter(m => ["Apresentador", "Apresentadora"].some(r => m.role.startsWith(r)))
    .map(m => m.name);
}

/** Equipe agrupada por função (apresentação primeiro), pra mostrar todas as funções no cartão semanal. */
function teamByRole(p: Product): { role: string; label: string; names: string[] }[] {
  const groups: { role: string; label: string; names: string[] }[] = [];
  for (const m of p.team) {
    if (!m.name?.trim()) continue;
    let g = groups.find(x => x.role === m.role);
    if (!g) {
      const isPresenter = ["Apresentador", "Apresentadora"].some(r => m.role.startsWith(r));
      g = { role: m.role, label: isPresenter ? "Apresentação" : m.role, names: [] };
      groups.push(g);
    }
    g.names.push(m.name);
  }
  return groups.sort((a, b) => Number(b.label === "Apresentação") - Number(a.label === "Apresentação"));
}

function talentCount(p: Product): number {
  return p.team.filter(m =>
    ["Narrador", "Comentarista", "Apresentador", "Apresentadora"].some(r => m.role.startsWith(r))
  ).length;
}

// ── Modo noturno ──────────────────────────────────────────────────────────────

function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark") return true;
      if (saved === "light") return false;
    } catch { /* localStorage indisponível */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* ignora */ }
  }, [dark]);

  return [dark, () => setDark(d => !d)] as const;
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={dark ? "Mudar para modo claro" : "Mudar para modo noturno"}
      aria-label={dark ? "Mudar para modo claro" : "Mudar para modo noturno"}
      aria-pressed={dark}
      className="text-sm leading-none text-gray-500 hover:text-gray-800 bg-white border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-2 transition-colors"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}

// ── ProductModal ──────────────────────────────────────────────────────────────

function ProductModal({
  product, onClose, isAdmin, onEdit, onDelete,
}: {
  product: Product; onClose: () => void;
  isAdmin?: boolean; onEdit?: () => void; onDelete?: () => void;
}) {
  const color  = productColor(product.shortName);
  const sc     = STATUS_COLORS[product.status];
  const tCount = talentCount(product);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
      <div
        className="relative z-10 w-full max-w-lg bg-white shadow-2xl rounded-xl overflow-hidden max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 w-full shrink-0" style={{ background: color }} />

        {/* Header */}
        <div className="px-6 pt-5 pb-4 shrink-0 border-b border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-white" style={{ background: color }}>
                  {product.shortName}
                </span>
                {product.channel && (
                  <span className="text-xs text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">
                    {product.channel}
                  </span>
                )}
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full border"
                  style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}
                >
                  {STATUS_LABEL[product.status]}
                </span>
              </div>
              <h2 className="text-xl font-bold text-gray-900">{product.name}</h2>
              <p className="mono text-sm text-gray-400 mt-0.5">
                {product.startTime} – {product.endTime} · {product.studio}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100 shrink-0 mt-0.5">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Talents (some eventos não têm equipe) */}
          {product.team.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                {product.type === "jogo" ? "Equipe de Transmissão" : "Talentos no Ar"}
              </p>
              <span className="mono text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                🎙️ {tCount} talento{tCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="space-y-2">
              {product.team.map((m, i) => (
                <div key={i} className="flex items-baseline gap-3">
                  <span className="text-xs text-gray-400 w-36 shrink-0">{m.role}</span>
                  <span className="text-sm font-medium text-gray-800">{m.name}</span>
                </div>
              ))}
            </div>
          </div>
          )}

          {product.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Observações</p>
              <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
                {product.notes}
              </p>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="px-6 py-3.5 border-t border-gray-100 shrink-0 flex gap-2 justify-end bg-gray-50/50">
            <button
              onClick={onDelete}
              className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 transition-colors"
            >
              Excluir
            </button>
            <button
              onClick={onEdit}
              className="px-3.5 py-1.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              Editar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── DayView (timeline) ────────────────────────────────────────────────────────

function DayView({
  schedule, dayIndex, todayStr, now,
  onClose, onSelectProduct,
}: {
  schedule: DaySchedule; dayIndex: number; todayStr: string; now: Date;
  onClose: () => void; onSelectProduct: (p: Product) => void;
}) {
  const nowMin  = currentMinutes(now);
  const isToday = schedule.date === todayStr;
  const dateObj = new Date(schedule.date + "T12:00:00");
  const dayNum  = dateObj.getDate();
  const month   = dateObj.toLocaleDateString("pt-BR", { month: "long" });

  const onAir = isToday ? schedule.products.find(p =>
    nowMin >= toMinutes(p.startTime) && nowMin < toMinutes(p.endTime)
  ) : undefined;
  const next = isToday ? schedule.products.find(p => toMinutes(p.startTime) > nowMin) : undefined;

  return (
    <div className="fixed inset-0 z-40 bg-[#f8fafc] flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 shrink-0 flex-wrap">
        <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M9 3L4 7.5 9 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Voltar para a Semana
        </button>
        <div className="w-px h-5 bg-gray-200" />
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900">{DAY_FULL[dayIndex]},</span>
          <span className="text-base text-gray-500">{dayNum} de {month}</span>
          {isToday && <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full ml-1">Hoje</span>}
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {isToday && onAir && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-700">Em exibição:</span>
              <span className="text-xs font-bold text-emerald-800">{onAir.name}</span>
            </div>
          )}
          {isToday && next && (
            <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span className="text-xs font-semibold text-sky-700">Próximo:</span>
              <span className="text-xs font-bold text-sky-800">{next.name}</span>
              <span className="mono text-xs text-sky-400">em {countdown(next.startTime, now)}</span>
            </div>
          )}
          <div className="text-right">
            <div className="mono text-xl font-bold text-gray-900 tabular-nums leading-none">{formatTime(now)}</div>
            <div className="mono text-[10px] text-gray-400 mt-0.5">Recife · UTC-3</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div className="relative">
            <div className="absolute left-20 top-0 bottom-0 w-px bg-gray-200" />

            {schedule.products.map((product, idx) => {
              const state   = getState(product, schedule.date, todayStr, nowMin);
              const isCancelled = product.status === "cancelado";
              const isOnAir = state === "on-air" && !isCancelled;
              const isNext  = product.id === next?.id && !isCancelled;
              const isDone  = state === "done";
              const color   = productColor(product.shortName);
              const names   = talentNames(product);
              const prevEnd = idx > 0 ? toMinutes(schedule.products[idx - 1].endTime) : 0;
              const showNow = isToday && nowMin >= prevEnd && nowMin < toMinutes(product.startTime);

              return (
                <div key={product.id}>
                  {showNow && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="mono text-xs font-bold text-red-500 w-[76px] text-right shrink-0">{formatTime(now)}</div>
                      <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 -ml-[4.5px]" />
                      <div className="flex-1 h-px bg-red-400" />
                      <span className="text-xs font-bold text-red-500 uppercase tracking-wide">Agora</span>
                    </div>
                  )}

                  <div className="flex gap-4 mb-2">
                    <div className={`mono text-xs w-[76px] text-right shrink-0 pt-4 leading-relaxed ${isDone || isCancelled ? "text-gray-300" : "text-gray-400"}`}>
                      <div>{product.startTime}</div>
                      <div className="text-gray-300">{product.endTime}</div>
                    </div>
                    <div className="relative flex items-start pt-[18px] shrink-0">
                      <div className="w-3 h-3 rounded-full border-2 border-white z-10 shadow-sm"
                        style={{ background: (isDone || isCancelled) ? "#d1d5db" : color, boxShadow: isOnAir ? `0 0 0 4px ${color}33` : undefined }} />
                    </div>
                    <div className="flex-1 mb-2 min-w-0">
                      <button
                        onClick={() => onSelectProduct(product)}
                        className={`w-full text-left rounded-xl border transition-all group
                          ${isOnAir ? "bg-white border-emerald-200 shadow-md"
                          : isNext  ? "bg-white border-sky-200 shadow-sm"
                          : isDone  ? "bg-white border-gray-100 opacity-50"
                          : isCancelled ? "bg-white border-gray-100 hover:border-gray-200"
                          : "bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300"}`}
                      >
                        <div className="px-4 py-3 flex gap-3">
                          <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: (isDone || isCancelled) ? "#e5e7eb" : color }} />
                          <div className="flex-1 min-w-0">
                            {(isOnAir || isNext) && (
                              <div className="flex gap-2 mb-1.5">
                                {isOnAir && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />🟢 Em exibição</span>}
                                {isNext && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 bg-sky-50 rounded-full px-2 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-sky-400" />🔵 Próximo</span>}
                              </div>
                            )}
                            <div className={`font-bold text-sm ${isCancelled ? "text-gray-400 line-through" : isDone ? "text-gray-400" : "text-gray-900"}`}>
                              {product.name}
                            </div>
                            <div className={`text-xs mt-0.5 ${isCancelled ? "text-gray-300 line-through" : "text-gray-400"}`}>{product.studio}</div>
                            {names.map((n, i) => (
                              <div key={i} className={`text-xs mt-0.5 ${isCancelled ? "text-gray-300 line-through" : "text-gray-600"}`}>{n}</div>
                            ))}
                            {isCancelled && (
                              <div className="mt-1.5">
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded border"
                                  style={{
                                    background: STATUS_COLORS.cancelado.bg,
                                    color:      STATUS_COLORS.cancelado.text,
                                    borderColor: STATUS_COLORS.cancelado.border,
                                  }}
                                >
                                  {STATUS_LABEL.cancelado}
                                </span>
                              </div>
                            )}
                            {product.type === "jogo" && (
                              <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                                🎙️ {talentCount(product)} talentos
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {isToday && schedule.products.length > 0 &&
              nowMin >= toMinutes(schedule.products[schedule.products.length - 1].endTime) && (
              <div className="flex items-center gap-3 py-2">
                <div className="mono text-xs font-bold text-red-500 w-[76px] text-right shrink-0">{formatTime(now)}</div>
                <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 -ml-[4.5px]" />
                <div className="flex-1 h-px bg-red-400" />
                <span className="text-xs font-bold text-red-500 uppercase tracking-wide">Agora</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DayColumn ─────────────────────────────────────────────────────────────────

function DayColumn({
  day, dayIndex, todayStr, nowMin, isAdmin,
  onOpenDay, onOpenProduct, onAddProduct,
}: {
  day: DaySchedule; dayIndex: number; todayStr: string; nowMin: number; isAdmin?: boolean;
  onOpenDay: () => void; onOpenProduct: (p: Product) => void; onAddProduct?: () => void;
}) {
  const isToday = day.date === todayStr;
  const dateObj = new Date(day.date + "T12:00:00");
  const dayNum  = dateObj.getDate();

  return (
    <div className="flex flex-col min-w-0">
      {/* Day header tab */}
      <button
        onClick={onOpenDay}
        className={`rounded-lg border px-3 py-2 mb-3 text-left transition-all hover:shadow-sm group
          ${isToday
            ? "bg-blue-600 border-blue-600 text-white"
            : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"}`}
      >
        <div className="flex items-center justify-between gap-1">
          <div>
            <div className={`text-[10px] font-bold tracking-widest uppercase ${isToday ? "text-blue-200" : "text-gray-400"}`}>
              {DAY_LABELS[dayIndex]}
            </div>
            <div className={`text-xl font-bold leading-tight ${isToday ? "text-white" : "text-gray-800"}`}>
              {dayNum}
            </div>
          </div>
          {isToday && (
            <span className="text-[10px] font-bold bg-white/20 text-white rounded px-1.5 py-0.5 self-start">
              Hoje
            </span>
          )}
        </div>
      </button>

      {/* Product list — flowing, no inner cards */}
      <div className="flex-1 bg-white border border-gray-200 rounded-lg overflow-hidden">
        {day.products.length === 0 ? (
          <div className="py-8 flex items-center justify-center">
            <span className="text-xs text-gray-300">Sem programação</span>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {day.products.map((product) => {
              const state      = getState(product, day.date, todayStr, nowMin);
              const isOnAir   = state === "on-air";
              const isNext    = state === "upcoming" &&
                day.products.find(p => getState(p, day.date, todayStr, nowMin) === "upcoming")?.id === product.id;
              const isDone    = state === "done";
              const color     = productColor(product.shortName);
              const names     = talentNames(product);
              const tCount    = talentCount(product);
              const isCancelled = product.status === "cancelado";

              return (
                <button
                  key={product.id}
                  onClick={() => onOpenProduct(product)}
                  className={`w-full text-left px-3 py-2.5 transition-colors group relative
                    ${isOnAir   ? "bg-emerald-50/70 hover:bg-emerald-50"
                    : isNext    ? "bg-sky-50/50 hover:bg-sky-50"
                    : isDone    ? "opacity-40 hover:opacity-60 bg-white"
                    : "bg-white hover:bg-gray-50"}`}
                >
                  {/* Left color accent bar */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r"
                    style={{ background: (isDone || isCancelled) ? "transparent" : color }}
                  />

                  <div className="pl-1.5">
                    {/* Time */}
                    <div className="mono text-[10px] text-gray-400 mb-0.5 tabular-nums">
                      {product.startTime}–{product.endTime}
                    </div>

                    {/* Product name */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className={`text-[11px] font-bold px-1.5 py-0.5 text-white ${
                          product.shortName === "EVENTO" ? "rounded-lg leading-tight break-words" : "rounded-full leading-none"
                        }`}
                        style={{ background: isCancelled ? "#d1d5db" : color }}
                      >
                        {product.shortName === "EVENTO" && product.name.trim() ? product.name : product.shortName}
                      </span>
                      {isOnAir && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                      {product.status === "alterado" && <span className="text-[9px] text-amber-600">⚠</span>}
                    </div>

                    {/* Studio */}
                    <div className="flex items-start gap-1 text-[11px] text-gray-500">
                      <span className="text-gray-300 shrink-0 mt-px">└</span>
                      <span className={isCancelled ? "line-through text-gray-300" : ""}>{product.studio}</span>
                    </div>

                    {/* Talents */}
                    {product.type === "jogo" ? (
                      <>
                        <div className="flex items-start gap-1 text-[11px] text-gray-500 mt-0.5">
                          <span className="text-gray-300 shrink-0 mt-px">└</span>
                          <span className="text-indigo-600 font-semibold">🎙️ {tCount} talentos</span>
                        </div>
                        {names.map((n, i) => (
                          <div key={i} className="text-[11px] text-gray-600 pl-3 leading-snug">{n}</div>
                        ))}
                        {product.channel && (
                          <div className="mt-1 inline-flex">
                            <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
                              {product.channel}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      teamByRole(product).map(group => (
                        <div key={group.role}>
                          <div className="flex items-start gap-1 text-[11px] text-gray-400 mt-0.5">
                            <span className="text-gray-300 shrink-0 mt-px">└</span>
                            <span>{group.label}</span>
                          </div>
                          {group.names.map((n, i) => (
                            <div key={i} className={`text-[11px] font-medium pl-3 leading-snug ${isCancelled ? "line-through text-gray-300" : "text-gray-700"}`}>
                              {n}
                            </div>
                          ))}
                        </div>
                      ))
                    )}

                    {/* Status badges (non-confirmado only) */}
                    {product.status !== "confirmado" && (
                      <div className="mt-1.5">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded border"
                          style={{
                            background: STATUS_COLORS[product.status].bg,
                            color:      STATUS_COLORS[product.status].text,
                            borderColor: STATUS_COLORS[product.status].border,
                          }}
                        >
                          {STATUS_LABEL[product.status]}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Column footer */}
        <div className="border-t border-gray-100 px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] text-gray-300">
            {day.products.length} produto{day.products.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={onOpenDay}
            className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors font-medium flex items-center gap-0.5"
          >
            Ver detalhes
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M3 1.5l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {isAdmin && (
          <button
            onClick={onAddProduct}
            className="w-full border-t border-gray-100 px-3 py-2 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
          >
            <span className="text-sm leading-none">+</span> Adicionar produto
          </button>
        )}
      </div>
    </div>
  );
}

// ── LoginModal ────────────────────────────────────────────────────────────────

function LoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (s: AdminSession) => void }) {
  const [name, setName]         = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [busy, setBusy]         = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const session = await login(name, password);
      if (session) {
        onSuccess(session);
      } else {
        setError("Senha incorreta.");
      }
    } catch {
      setError("Não foi possível entrar. Abra o site por um endereço seguro (https).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm bg-white shadow-2xl rounded-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 w-full bg-blue-600" />
        <div className="px-6 pt-5 pb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-0.5">Entrar como Admin</h2>
          <p className="text-xs text-gray-400 mb-5">Só quem tem a senha pode editar a programação.</p>

          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">
            Seu nome
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); setError(""); }}
            placeholder="Ex: Ana Souza"
            required
            className="w-full mb-4 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />

          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">
            Senha
          </label>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            placeholder="••••••••"
            required
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
          {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}

          <div className="flex gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 border border-gray-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Histórico de edições ──────────────────────────────────────────────────────
function EditLogModal({ entries, onClose, error, canDelete }: { entries: EditLogEntry[]; onClose: () => void; error?: string | null; canDelete?: boolean }) {
  const [busy, setBusy]               = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function runDelete(task: () => Promise<unknown>) {
    setBusy(true);
    setDeleteError("");
    try {
      await task(); // a lista se atualiza sozinha (tempo real)
    } catch (err) {
      console.error("Erro ao apagar histórico:", err);
      const code = (err as { code?: string })?.code;
      setDeleteError(code === "permission-denied"
        ? "O Firebase bloqueou a exclusão. Nas regras do Firestore, permita \"delete\" na coleção editLogs."
        : "Não foi possível apagar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function handleClearAll() {
    if (!window.confirm("Apagar TODO o histórico de alterações? Isso não pode ser desfeito.")) return;
    void runDelete(() => clearEditLog());
  }

  function handleDeleteOne(id: string) {
    if (!window.confirm("Apagar este registro do histórico?")) return;
    void runDelete(() => deleteEditLogEntry(id));
  }

  const actionLabel: Record<EditLogEntry["action"], string> = {
    created: "Criou", updated: "Editou", deleted: "Excluiu",
  };
  const actionColor: Record<EditLogEntry["action"], string> = {
    created: "bg-emerald-50 text-emerald-700 border-emerald-200",
    updated: "bg-amber-50 text-amber-700 border-amber-200",
    deleted: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <section className="relative z-10 w-full max-w-2xl bg-white shadow-2xl rounded-xl overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Histórico de edições</h2>
            <p className="text-xs text-gray-400 mt-0.5">Últimas 100 alterações registradas</p>
          </div>
          <div className="flex items-center gap-2">
            {canDelete && entries.length > 0 && (
              <button
                onClick={handleClearAll}
                disabled={busy}
                className="text-xs font-semibold text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-50 rounded-lg px-2.5 py-1.5 disabled:opacity-50 transition-colors"
              >
                {busy ? "Apagando…" : "Limpar histórico"}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 rounded-lg px-2 py-1">Fechar</button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 space-y-2">
          {deleteError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {deleteError}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {entries.length === 0 && !error ? (
            <p className="text-sm text-gray-400 text-center py-10">Nenhuma edição registrada ainda.</p>
          ) : entries.map((entry, index) => (
            <article key={entry.id ?? index} className="border border-gray-100 rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 ${actionColor[entry.action]}`}>{actionLabel[entry.action]}</span>
                <span className="text-sm font-semibold text-gray-800">{entry.productName}</span>
                {canDelete && entry.id && (
                  <button
                    onClick={() => handleDeleteOne(entry.id!)}
                    disabled={busy}
                    className="ml-auto text-[11px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Apagar
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-1.5">{entry.details}</p>
              <div className="flex flex-wrap justify-between gap-1 mt-2 text-[11px] text-gray-400">
                <span>Por {entry.actor}</span>
                <span>{new Date(entry.createdAt).toLocaleString("pt-BR")} · {new Date(entry.date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── ProductForm (criar / editar) ─────────────────────────────────────────────

interface ProductFormState {
  kind: ProductKindKey;
  name: string;
  startTime: string;
  endTime: string;
  studio: string;
  channel: string;
  status: Status;
  notes: string;
  team: TeamMember[];
}

function kindDefaults(kind: ProductKindKey): ProductFormState {
  const info = PRODUCT_KINDS.find(k => k.key === kind)!;
  return {
    kind,
    name: info.label,
    startTime: info.defaultStart ?? "08:00",
    endTime: info.defaultEnd ?? "09:00",
    studio: info.defaultStudio,
    channel: "",
    status: "previsto",
    notes: "",
    team: [],
  };
}

function productToForm(p: Product): ProductFormState {
  const kind = (PRODUCT_KINDS.find(k => k.key === p.shortName)?.key ?? "BDPE") as ProductKindKey;
  return {
    kind,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    studio: p.studio,
    channel: p.channel ?? "",
    status: p.status,
    notes: p.notes ?? "",
    team: p.team,
  };
}

function ProductFormModal({
  dateLabel, initial, isEditing, saving, onClose, onSave,
}: {
  dateLabel: string;
  initial: ProductFormState;
  isEditing: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (form: ProductFormState) => void;
}) {
  const [form, setForm]         = useState<ProductFormState>(initial);
  const [peopleVersion, bump]   = useState(0); // força atualizar lista após addPerson/addRole
  const [newPersonByRole, setNewPersonByRole] = useState<Record<string, string>>({});
  const [newRoleName, setNewRoleName]         = useState("");
  const [formError, setFormError]             = useState("");

  const roles     = useMemo(() => getRolesFor(form.kind), [form.kind, peopleVersion]);
  const kindInfo  = PRODUCT_KINDS.find(k => k.key === form.kind)!;

  function changeKind(kind: ProductKindKey) {
    const defaults = kindDefaults(kind);
    const info     = PRODUCT_KINDS.find(k => k.key === kind)!;
    // Produtos com horário padrão (BDPE, NE1, GE, Boletim, NE2) trocam o horário; os demais mantêm o que foi digitado.
    setForm(f => ({
      ...defaults,
      startTime: info.defaultStart ?? f.startTime,
      endTime:   info.defaultEnd   ?? f.endTime,
      name: defaults.name,
    }));
  }

  function isChecked(role: string, person: string) {
    return form.team.some(m => m.role === role && m.name === person);
  }

  function toggleMember(role: string, person: string) {
    setForm(f => {
      const exists = f.team.some(m => m.role === role && m.name === person);
      const team = exists
        ? f.team.filter(m => !(m.role === role && m.name === person))
        : [...f.team, { role, name: person }];
      return { ...f, team };
    });
  }

  function handleAddPersonForRole(role: string) {
    const name = (newPersonByRole[role] ?? "").trim();
    if (!name) return;
    addPerson(role, name);
    setNewPersonByRole(s => ({ ...s, [role]: "" }));
    bump(v => v + 1);
  }

  function handleRemovePersonForRole(role: string, person: string) {
    if (!window.confirm(`Remover "${person}" da lista de sugestões de ${role}? Os produtos já salvos não serão alterados.`)) return;
    removePerson(role, person);
    setForm(current => ({ ...current, team: current.team.filter(member => !(member.role === role && member.name === person)) }));
    bump(version => version + 1);
  }

  function handleAddRole() {
    if (!newRoleName.trim()) return;
    addRole(form.kind, newRoleName);
    setNewRoleName("");
    bump(v => v + 1);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Campos obrigatórios (o "required" do HTML aceita só espaços, então validamos com trim)
    const missing: string[] = [];
    if (!form.name.trim())   missing.push("Nome");
    if (!form.studio.trim()) missing.push("Estúdio / Local");
    // Em Evento a equipe (apresentador) é opcional
    if (form.kind !== "EVENTO" && form.team.length === 0) missing.push("Equipe (marque ao menos uma pessoa)");
    if (missing.length > 0) {
      setFormError(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
      return;
    }
    setFormError("");
    onSave({ ...form, name: form.name.trim(), studio: form.studio.trim(), channel: form.channel.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-xl bg-white shadow-2xl rounded-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 w-full shrink-0" style={{ background: productColor(form.kind) }} />

        <div className="px-6 pt-5 pb-4 shrink-0 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isEditing ? "Editar produto" : "Novo produto"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{dateLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-300 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Tipo de produto */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
              Produto
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRODUCT_KINDS.map(k => (
                <button
                  type="button"
                  key={k.key}
                  onClick={() => changeKind(k.key)}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-full border transition-colors ${
                    form.kind === k.key ? "text-white" : "text-gray-500 bg-white border-gray-200 hover:border-gray-300"
                  }`}
                  style={form.kind === k.key ? { background: PRODUCT_COLORS[k.key], borderColor: PRODUCT_COLORS[k.key] } : undefined}
                >
                  {k.key}
                </button>
              ))}
            </div>
          </div>

          {/* Nome / horários / estúdio */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Nome<span className="text-red-500"> *</span></label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Início<span className="text-red-500"> *</span></label>
              <input
                type="time"
                value={form.startTime}
                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Fim<span className="text-red-500"> *</span></label>
              <input
                type="time"
                value={form.endTime}
                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Estúdio / Local<span className="text-red-500"> *</span></label>
              <input
                value={form.studio}
                onChange={e => setForm(f => ({ ...f, studio: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as Status }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              >
                <option value="confirmado">Confirmado</option>
                <option value="previsto">Previsto</option>
                <option value="alterado">Alterado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
            {kindInfo.type === "jogo" && (
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Canal / Transmissão</label>
                <input
                  value={form.channel}
                  onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                  placeholder="Ex: SporTV"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
              </div>
            )}
          </div>

          {/* Equipe */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Equipe{form.kind !== "EVENTO" && <span className="text-red-500"> *</span>}</p>
              <span className="mono text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                {form.team.length} selecionado{form.team.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="space-y-3">
              {roles.map(role => {
                const peopleForRole = getPeopleForRole(role);
                return (
                  <div key={role} className="border border-gray-100 rounded-lg px-3 py-2.5">
                    <div className="text-xs font-semibold text-gray-600 mb-1.5">{role}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {peopleForRole.map(person => {
                        const checked = isChecked(role, person);
                        return (
                          <div key={person} className="inline-flex items-center rounded-full border border-gray-200 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => toggleMember(role, person)}
                              className={`text-xs px-2.5 py-1 transition-colors ${
                                checked ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              {person}
                            </button>
                            <button
                              type="button"
                              title={`Remover ${person} da lista`}
                              aria-label={`Remover ${person} da lista de ${role}`}
                              onClick={() => handleRemovePersonForRole(role, person)}
                              className="px-1.5 py-1 text-xs text-red-500 bg-white hover:bg-red-50 border-l border-gray-200"
                            >×</button>
                          </div>
                        );
                      })}
                      {peopleForRole.length === 0 && (
                        <span className="text-[11px] text-gray-300 italic py-1">Nenhuma pessoa cadastrada ainda</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <input
                        value={newPersonByRole[role] ?? ""}
                        onChange={e => setNewPersonByRole(s => ({ ...s, [role]: e.target.value }))}
                        placeholder={`Nova pessoa em ${role}`}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 w-44"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddPersonForRole(role)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 px-1.5"
                      >
                        + adicionar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Adicionar função nova */}
            <div className="flex items-center gap-1.5 mt-3">
              <input
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                placeholder="Nova função (ex: Editor de imagens)"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 w-56"
              />
              <button type="button" onClick={handleAddRole} className="text-xs font-semibold text-blue-600 hover:text-blue-800 px-1.5">
                + adicionar função
              </button>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Observações</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 resize-none"
            />
          </div>
        </div>

        {formError && (
          <div role="alert" className="mx-6 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shrink-0">
            {formError}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 border border-gray-200 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-60">
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const now      = useRecifeTime();
  const todayStr = now.toISOString().slice(0, 10);
  const nowMin   = currentMinutes(now);

  const [weekOffset, setWeekOffset]   = useState(0);
  const [selectedDay, setSelectedDay] = useState<{ schedule: DaySchedule; index: number } | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [shift, setShift] = useState<Shift>("todos");
  const [dark, toggleDark] = useDarkMode();

  // ── Admin ──
  const [session, setSession]     = useState<AdminSession | null>(() => getSession());
  const [showLogin, setShowLogin] = useState(false);
  const [showEditLog, setShowEditLog] = useState(false);
  const [editLog, setEditLog] = useState<EditLogEntry[]>([]);
  const [editLogError, setEditLogError] = useState<string | null>(null);
  const isAdmin = !!session;
  const isSuper = session?.role === "super";

  // ── Formulário de produto (criar/editar) ──
  const [formTarget, setFormTarget] = useState<{ date: string; product?: Product } | null>(null);
  const [saving, setSaving] = useState(false);

  const weekDates = useMemo(() => {
    const ref = new Date(now);
    ref.setDate(ref.getDate() + weekOffset * 7);
    return getWeekDates(ref);
  }, [weekOffset, todayStr]);

  // ── Programação (Firestore, em tempo real) ──
  const [schedule, setSchedule] = useState<DaySchedule[]>(() => weekDates.map(date => ({ date, products: [] })));

  useEffect(() => {
    setSchedule(weekDates.map(date => ({ date, products: [] }))); // evita mostrar a semana anterior enquanto carrega
    const unsubscribe = subscribeToSchedule(weekDates, setSchedule);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDates.join(",")]);

  // O histórico é público: qualquer pessoa pode acompanhar as alterações.
  useEffect(() => {
    return subscribeToEditLog(entries => {
      setEditLog(entries);
      setEditLogError(null);
    }, setEditLogError);
  }, []);

  function handleLoginSuccess(s: AdminSession) {
    setSession(s);
    setShowLogin(false);
  }

  function handleLogout() {
    logout();
    setSession(null);
  }

  async function handleSaveProduct(form: ProductFormState) {
    if (!formTarget) return;
    const kindInfo = PRODUCT_KINDS.find(k => k.key === form.kind)!;
    const payload: Omit<Product, "id"> = {
      name: form.name,
      shortName: form.kind,
      type: kindInfo.type,
      startTime: form.startTime,
      endTime: form.endTime,
      studio: form.studio,
      status: form.status,
      team: form.team,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      ...(form.channel.trim() ? { channel: form.channel.trim() } : {}),
    };
    setSaving(true);
    try {
      let action: EditLogEntry["action"];
      let details: string;
      if (formTarget.product) {
        await updateProduct(formTarget.date, formTarget.product.id, payload, weekDates);
        action = "updated";
        const labels: Record<string, string> = {
          name: "nome", startTime: "horário de início", endTime: "horário de fim", studio: "estúdio/local",
          status: "status", team: "equipe", notes: "observações", channel: "canal", shortName: "tipo de produto",
        };
        const keys = Object.keys(labels) as (keyof Omit<Product, "id">)[];
        const changed = keys.filter(key => JSON.stringify(formTarget.product![key]) !== JSON.stringify(payload[key]));
        const describeValue = (value: unknown): string => {
          if (Array.isArray(value)) return value.length
            ? value.map(item => typeof item === "object" && item !== null
              ? `${"role" in item ? String(item.role) + ": " : ""}${"name" in item ? String(item.name) : JSON.stringify(item)}`
              : String(item)).join("; ")
            : "vazio";
          if (value === undefined || value === null || value === "") return "vazio";
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        };
        details = changed.length
          ? changed.map(key => `${labels[key]}: “${describeValue(formTarget.product![key])}” → “${describeValue(payload[key])}”`).join(" | ")
          : "Produto salvo sem mudanças nos campos monitorados.";
      } else {
        await addProduct(formTarget.date, payload, weekDates);
        action = "created";
        details = `Produto cadastrado das ${payload.startTime} às ${payload.endTime}.`;
      }
      try {
        await recordEditLog({
          actor: session?.name || "Admin", action, date: formTarget.date, productName: payload.name,
          details, createdAt: new Date().toISOString(),
        });
      } catch (logError) {
        console.error("Produto salvo, mas não foi possível registrar no histórico:", logError);
        window.alert("A programação foi salva, mas o histórico não foi registrado. É necessário liberar leitura e gravação da coleção editLogs nas regras do Firebase Firestore.");
      }
      setFormTarget(null);
      setSelectedProduct(null);
    } catch (err) {
      console.error(err);
      window.alert("Não foi possível salvar agora. Confira sua conexão (ou a configuração do Firebase) e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProduct(date: string, product: Product) {
    if (!window.confirm(`Excluir "${product.name}" da programação?`)) return;
    try {
      await deleteProduct(date, product.id);
      try {
        await recordEditLog({
          actor: session?.name || "Admin", action: "deleted", date, productName: product.name,
          details: `Produto removido da programação (${product.startTime}–${product.endTime}).`,
          createdAt: new Date().toISOString(),
        });
      } catch (logError) {
        console.error("Produto excluído, mas não foi possível registrar no histórico:", logError);
        window.alert("O produto foi excluído, mas o histórico não foi registrado. É necessário liberar leitura e gravação da coleção editLogs nas regras do Firebase Firestore.");
      }
      setSelectedProduct(null);
    } catch (err) {
      console.error(err);
      window.alert("Não foi possível excluir agora. Confira sua conexão e tente de novo.");
    }
  }

  const todaySchedule = schedule.find(d => d.date === todayStr);
  const onAirProduct  = todaySchedule?.products.find(p =>
    nowMin >= toMinutes(p.startTime) && nowMin < toMinutes(p.endTime)
  );
  const nextProduct = todaySchedule?.products.find(p => toMinutes(p.startTime) > nowMin);

  const weekLabel = (() => {
    const s = new Date(weekDates[0] + "T12:00:00");
    const e = new Date(weekDates[6] + "T12:00:00");
    const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
    return `${fmt(s)} — ${fmt(e)}`;
  })();

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">

      {/* ═══ HEADER ═══ */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shrink-0">
        <div className="px-5 py-3 flex items-center gap-4">

          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                <circle cx="8.5" cy="8.5" r="6.5" stroke="white" strokeWidth="1.4" />
                <ellipse cx="8.5" cy="8.5" rx="2.8" ry="6.5" stroke="white" strokeWidth="1.4" />
                <path d="M2 8.5h13" stroke="white" strokeWidth="1.4" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900 leading-tight">Rede Globo Pernambuco</div>
              <div className="text-[10px] text-gray-400">Quadro de Produtos</div>
            </div>
          </div>

          {/* Live chips */}
          <div className="flex items-center gap-2.5 flex-1 justify-center flex-wrap">
            {/* Em exibição */}
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
              onAirProduct ? "bg-emerald-50 border-emerald-200" : "bg-gray-50 border-gray-100 opacity-40"
            }`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${onAirProduct ? "bg-emerald-500 animate-pulse" : "bg-gray-300"}`} />
              <span className="text-xs text-gray-500 font-medium">● Em exibição</span>
              {onAirProduct
                ? <span className="text-sm font-bold text-emerald-800">{onAirProduct.name}</span>
                : <span className="text-sm text-gray-300">—</span>
              }
            </div>

            {/* Próximo */}
            {nextProduct && (
              <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-500 font-medium">Próximo</span>
                <span className="text-sm font-bold text-sky-800">{nextProduct.name}</span>
                <span className="mono text-xs text-sky-500 border border-sky-200 rounded px-1.5 py-0.5 bg-white/60">
                  {nextProduct.startTime} em {countdown(nextProduct.startTime, now)}
                </span>
              </div>
            )}
          </div>

          {/* Clock */}
          <div className="shrink-0 text-right">
            <div className="mono text-2xl font-bold text-gray-900 tabular-nums leading-none">{formatTime(now)}</div>
            <div className="mono text-[10px] text-gray-400 mt-0.5">Recife · UTC-3</div>
          </div>

          {/* Admin */}
          <div className="shrink-0">
            {isAdmin ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg pl-3 pr-1.5 py-1.5">
                <ThemeToggle dark={dark} onToggle={toggleDark} />
                <span className="text-xs font-semibold text-emerald-700">{isSuper ? "⭐" : "🔓"} {session!.name}{isSuper && <span className="ml-1.5 text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 rounded px-1 py-0.5">Super</span>}</span>
                <button
                  onClick={() => setShowEditLog(true)}
                  className="text-[11px] font-medium text-blue-700 hover:text-blue-900 bg-white border border-blue-200 rounded px-2 py-1 transition-colors"
                >
                  Histórico
                </button>
                <button
                  onClick={handleLogout}
                  className="text-[11px] font-medium text-emerald-700 hover:text-emerald-900 bg-white border border-emerald-200 rounded px-2 py-1 transition-colors"
                >
                  Sair
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ThemeToggle dark={dark} onToggle={toggleDark} />
                <button
                  onClick={() => setShowEditLog(true)}
                  className="text-xs font-medium text-blue-700 hover:text-blue-900 bg-white border border-blue-200 rounded-lg px-3 py-2 transition-colors"
                >
                  Histórico
                </button>
                <button
                  onClick={() => setShowLogin(true)}
                  className="text-xs font-medium text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 transition-colors"
                >
                  🔒 Modo Admin
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Nav row */}
        <div className="px-5 pb-2.5 flex items-center gap-2 border-t border-gray-50 pt-2 flex-wrap">
          {/* Week nav */}
          <button onClick={() => setWeekOffset(o => o - 1)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={() => { setWeekOffset(0); setSelectedDay(null); }}
            className="px-3 py-1 rounded text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors">
            Hoje
          </button>
          <button onClick={() => setWeekOffset(o => o + 1)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="text-sm text-gray-500 ml-1">{weekLabel}</span>

          <div className="w-px h-4 bg-gray-200 mx-1" />

          {/* Shift tabs */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {SHIFTS.map(s => {
              const isActive = shift === s.key;
              const isCurrent = s.key !== "todos" && s.key === currentShift(nowMin) && weekOffset === 0;
              return (
                <button
                  key={s.key}
                  onClick={() => setShift(s.key)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-all relative ${
                    isActive
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {s.label}
                  {s.range && <span className={`ml-1 text-[10px] font-normal ${isActive ? "text-gray-400" : "text-gray-400"}`}>{s.range}</span>}
                  {isCurrent && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ═══ GRID ═══ */}
      <main className="flex-1 p-4 overflow-x-auto">
        <div className="grid gap-3 h-full" style={{ gridTemplateColumns: "repeat(7, minmax(140px, 1fr))" }}>
          {schedule.map((day, idx) => (
            <DayColumn
              key={day.date}
              day={{ ...day, products: day.products.filter(p => productInShift(p, shift)) }}
              dayIndex={idx}
              todayStr={todayStr}
              nowMin={nowMin}
              isAdmin={isAdmin}
              onOpenDay={() => setSelectedDay({ schedule: day, index: idx })}
              onOpenProduct={p => setSelectedProduct(p)}
              onAddProduct={() => setFormTarget({ date: day.date })}
            />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white px-5 py-2 flex items-center justify-between shrink-0">
        <span className="text-[11px] text-gray-300">Rede Globo Pernambuco · Quadro de Produtos</span>
        <span className="mono text-[11px] text-gray-300">
          {now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        </span>
      </footer>

      {/* ═══ DAY VIEW ═══ */}
      {selectedDay && (
        <DayView
          schedule={selectedDay.schedule}
          dayIndex={selectedDay.index}
          todayStr={todayStr}
          now={now}
          onClose={() => setSelectedDay(null)}
          onSelectProduct={p => setSelectedProduct(p)}
        />
      )}

      {/* ═══ PRODUCT MODAL ═══ */}
      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          isAdmin={isAdmin}
          onEdit={() => {
            const date = schedule.find(d => d.products.some(p => p.id === selectedProduct.id))?.date;
            if (date) setFormTarget({ date, product: selectedProduct });
          }}
          onDelete={() => {
            const date = schedule.find(d => d.products.some(p => p.id === selectedProduct.id))?.date;
            if (date) handleDeleteProduct(date, selectedProduct);
          }}
        />
      )}

      {/* ═══ HISTÓRICO ═══ */}
      {showEditLog && (
        <EditLogModal entries={editLog} error={editLogError} canDelete={isSuper} onClose={() => setShowEditLog(false)} />
      )}

      {/* ═══ LOGIN ═══ */}
      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)} onSuccess={handleLoginSuccess} />
      )}

      {/* ═══ FORM DE PRODUTO ═══ */}
      {formTarget && (
        <ProductFormModal
          dateLabel={new Date(formTarget.date + "T12:00:00").toLocaleDateString("pt-BR", {
            weekday: "long", day: "2-digit", month: "long",
          })}
          initial={formTarget.product ? productToForm(formTarget.product) : kindDefaults("BDPE")}
          isEditing={!!formTarget.product}
          saving={saving}
          onClose={() => setFormTarget(null)}
          onSave={handleSaveProduct}
        />
      )}
    </div>
  );
}

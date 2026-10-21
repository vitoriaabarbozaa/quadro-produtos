export type Status = "confirmado" | "previsto" | "alterado" | "cancelado";
export type ProductType = "programa" | "jogo";

export interface TeamMember {
  role: string;
  name: string;
}

export interface Product {
  id: string;
  name: string;
  shortName: string;
  type: ProductType;
  startTime: string;
  endTime: string;
  studio: string;
  status: Status;
  team: TeamMember[];
  notes?: string;
  channel?: string;
}

export interface DaySchedule {
  date: string; 
  products: Product[];
  note?: string; 
}

let _id = 1;
function id() { return String(_id++); }

function prog(
  name: string, shortName: string,
  start: string, end: string,
  studio: string, status: Status,
  team: TeamMember[], notes?: string
): Product {
  return { id: id(), name, shortName, type: "programa", startTime: start, endTime: end, studio, status, team, ...(notes ? { notes } : {}) };
}

/** Data local no formato AAAA-MM-DD (sem passar por UTC, que muda o dia depois das 21h em Recife). */
export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getWeekDates(referenceDate: Date): string[] {
  const d = new Date(referenceDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(d);
    dd.setDate(dd.getDate() + i);
    return dateKey(dd);
  });
}

// Produtos fixos, com horário padrão. Jogo, GCO, Descomplica e Evento não entram
// aqui: são adicionados pelo admin manualmente, só nos dias em que acontecem.
//   • Segunda a sexta: BDPE, NE1, GE, Boletim e NE2
//   • Sábado: NE1, GE e NE2
//   • Domingo: nenhum
function fixedProducts(date: string): Product[] {
  const weekday = new Date(date + "T12:00:00").getDay(); // 0 = domingo ... 6 = sábado
  if (weekday === 0) return [];
  const all: Product[] = [
    prog("Bom Dia PE", "BDPE", "06:00", "08:30", "Estúdio 1", "confirmado", [
      { role: "Apresentador(a)", name: "Clarissa Góes" },
    ]),
    prog("NE1", "NE1", "11:45", "13:00", "Estúdio 1", "confirmado", [
      { role: "Apresentador(a)", name: "Maristela Niz" },
    ]),
    prog("Globo Esporte PE", "GE", "13:00", "13:30", "Estúdio 1", "confirmado", [
      { role: "Apresentador(a)", name: "Tiago Medeiros" },
    ]),
    prog("Boletim", "BOLETIM", "17:00", "17:10", "Estúdio 1", "confirmado", [
      { role: "Apresentador(a)", name: "Márcio Bonfim" },
    ]),
    prog("NE2", "NE2", "19:00", "19:30", "Estúdio 1", "confirmado", [
      { role: "Apresentador(a)", name: "Márcio Bonfim" },
    ]),
  ];
  if (weekday === 6) return all.filter(p => ["NE1", "GE", "NE2"].includes(p.shortName));
  return all;
}

export function buildSchedule(weekDates: string[]): DaySchedule[] {
  return weekDates.map(date => ({ date, products: fixedProducts(date) }));
}

export const PRODUCT_COLORS: Record<string, string> = {
  BDPE:        "#eab308", // amarelo
  NE1:         "#f59e0b", // âmbar / amarelo-laranja
  GE:          "#f97316", // laranja
  BOLETIM:     "#60a5fa", // azul claro
  NE2:         "#1d4ed8", // azul escuro
  JOGO:        "#dc2626", // vermelho
  GCO:         "#ec4899", // rosa
  DESCOMPLICA: "#7c3aed", // roxo
  EVENTO:      "#14b8a6", // verde-azulado
};

/**
 * Calendário da clínica: "hoje", semanas e meses são dias de calendário em America/Sao_Paulo,
 * nunca o dia UTC (`new Date().toISOString().slice(0, 10)` já é "amanhã" a partir das 21h em São Paulo).
 * Instantes puros (createdAt, expiração, janelas móveis de N horas) continuam em UTC.
 */

/** Fuso da clínica: "hoje" para vencido/agendado é o dia de calendário aqui. */
export const CLINIC_TIME_ZONE = "America/Sao_Paulo";

/** Data de hoje ("YYYY-MM-DD") no fuso da clínica. */
export function clinicToday(now: Date = new Date(), timeZone: string = CLINIC_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parseDay(day: string): [number, number, number] {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return [y!, m!, d!];
}

function formatDay(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** Soma `days` dias a uma data de calendário ("YYYY-MM-DD"), sem passar por fuso. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = parseDay(day);
  return formatDay(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Semana de calendário (domingo a sábado) que contém `day`. */
export function weekRange(day: string): { from: string; to: string } {
  const [y, m, d] = parseDay(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const from = addDays(day, -weekday);
  return { from, to: addDays(from, 6) };
}

/** Mês de calendário que contém `day`. */
export function monthRange(day: string): { from: string; to: string } {
  const [y, m] = parseDay(day);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/** Diferença (ms) entre o relógio de parede do fuso e o UTC no instante dado. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instante em que começa o dia de calendário `day` no fuso da clínica. */
export function clinicDayStart(day: string, timeZone: string = CLINIC_TIME_ZONE): Date {
  const [y, m, d] = parseDay(day);
  const utcMidnight = Date.UTC(y, m - 1, d);
  let start = utcMidnight - zoneOffsetMs(new Date(utcMidnight), timeZone);
  // Segunda passada: o deslocamento pode mudar entre a estimativa e o instante real (horário de verão)
  start = utcMidnight - zoneOffsetMs(new Date(start), timeZone);
  return new Date(start);
}

/** Intervalo [início, fim] (fim inclusivo, último milissegundo) do dia `day` no fuso da clínica. */
export function clinicDayBounds(day: string, timeZone: string = CLINIC_TIME_ZONE): { start: Date; end: Date } {
  const start = clinicDayStart(day, timeZone);
  const next = clinicDayStart(addDays(day, 1), timeZone);
  return { start, end: new Date(next.getTime() - 1) };
}

/** Idade em anos completos no dia de calendário `today` para uma data de nascimento "YYYY-MM-DD". */
export function ageOn(birthDate: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const [by, bm, bd] = parseDay(birthDate);
  const [ty, tm, td] = parseDay(today);
  if (!by || !bm || !bd) return null;
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

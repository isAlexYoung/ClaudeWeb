/**
 * Holidays the new-chat Clawd greets, on the user's local calendar day: Western and
 * Chinese solar dates, a few moving Western days, and the Chinese lunar festivals.
 * Lunar dates come from the browser's Chinese calendar (Intl), so no table needs updating.
 */
export type FestivalId =
  | 'newYear' | 'valentine' | 'aprilFools' | 'easter' | 'mothersDay' | 'fathersDay' | 'halloween'
  | 'thanksgiving' | 'christmasEve' | 'christmas' | 'newYearsEve'
  | 'laborDay' | 'childrensDay' | 'nationalDay' | 'programmersDay'
  | 'chuxi' | 'springFestival' | 'lantern' | 'dragonBoat' | 'qixi' | 'midAutumn' | 'chongyang' | 'laba';

type LunarDay = { month: number; day: number; leap: boolean };

let lunarFormat: Intl.DateTimeFormat | null | undefined;

/** The Chinese-calendar month and day of a local date; null where the browser has no Chinese calendar. */
export function lunarDate(date: Date): LunarDay | null {
  if (lunarFormat === undefined) {
    try { lunarFormat = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric' }); }
    catch { lunarFormat = null; }
  }
  if (!lunarFormat) return null;
  const parts = lunarFormat.formatToParts(date);
  const month = /^(\d+)(bis)?$/.exec(parts.find((part) => part.type === 'month')?.value ?? '');
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (!month || !Number.isInteger(day)) return null;
  return { month: Number(month[1]), day, leap: Boolean(month[2]) };
}

/** Day of month of the nth given weekday (0 = Sunday) in a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(year, month, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(year, month + 1, 0);
  return lastDay.getDate() - ((lastDay.getDay() - weekday + 7) % 7);
}

/** Western Easter Sunday (anonymous Gregorian algorithm) as [month index, day]. */
function easter(year: number): [number, number] {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month - 1, day];
}

/** Used by pickGreeting: the holidays falling on this local day, most specific first. */
export function festivalsOn(date: Date): FestivalId[] {
  const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
  const found: FestivalId[] = [];
  const on = (m: number, d: number) => month === m && day === d;

  const lunar = lunarDate(date);
  if (lunar && !lunar.leap) {
    const tomorrow = lunarDate(new Date(year, month, day + 1, 12));
    if (tomorrow && !tomorrow.leap && tomorrow.month === 1 && tomorrow.day === 1) found.push('chuxi');
    if (lunar.month === 1 && lunar.day <= 7) found.push('springFestival');
    if (lunar.month === 1 && lunar.day === 15) found.push('lantern');
    if (lunar.month === 5 && lunar.day === 5) found.push('dragonBoat');
    if (lunar.month === 7 && lunar.day === 7) found.push('qixi');
    if (lunar.month === 8 && lunar.day === 15) found.push('midAutumn');
    if (lunar.month === 9 && lunar.day === 9) found.push('chongyang');
    if (lunar.month === 12 && lunar.day === 8) found.push('laba');
  }

  if (on(0, 1)) found.push('newYear');
  if (on(1, 14)) found.push('valentine');
  if (on(3, 1)) found.push('aprilFools');
  const [easterMonth, easterDay] = easter(year);
  if (on(easterMonth, easterDay)) found.push('easter');
  if (on(4, 1)) found.push('laborDay');
  if (on(4, nthWeekday(year, 4, 0, 2))) found.push('mothersDay');
  if (on(5, 1)) found.push('childrensDay');
  if (on(5, nthWeekday(year, 5, 0, 3))) found.push('fathersDay');
  if (on(9, 1)) found.push('nationalDay');
  if (on(9, 24)) found.push('programmersDay');
  if (on(9, 31)) found.push('halloween');
  if (on(10, nthWeekday(year, 10, 4, 4))) found.push('thanksgiving');
  if (on(11, 24)) found.push('christmasEve');
  if (on(11, 25)) found.push('christmas');
  if (on(11, 31)) found.push('newYearsEve');
  return found;
}

import { festivalsOn } from '@/modules/clawd/festivals';
import type { FestivalId } from '@/modules/clawd/festivals';

export type ClawdMode = 'chat' | 'code';

/**
 * What the new-chat Clawd says and does. The bubble text and the prompt it puts in the
 * composer are translated as `clawd.greetings.<id>.text` and `.prompt` (common namespace).
 */
export type ClawdGreeting = {
  id: string;
  /** Animations from the catalog, in the order a double click steps through them. */
  animations: number[];
};

type Slot = 'morning' | 'afternoon' | 'evening' | 'night';

const FESTIVAL_GREETINGS: Record<FestivalId, number[]> = {
  newYear: [365, 366, 367],
  valentine: [376, 68, 368],
  aprilFools: [111, 321, 65],
  easter: [377],
  mothersDay: [68, 67, 78],
  fathersDay: [62, 77],
  halloween: [349, 351, 350, 352, 355],
  thanksgiving: [78, 67, 123],
  christmasEve: [357, 361, 360],
  christmas: [359, 363, 357, 362],
  newYearsEve: [365, 366, 367],
  laborDay: [135, 46, 73],
  childrensDay: [32, 33, 165],
  nationalDay: [366, 345],
  programmersDay: [213, 228, 208],
  chuxi: [371, 365, 366],
  springFestival: [369, 372, 373, 371],
  lantern: [370],
  dragonBoat: [375],
  qixi: [376, 70],
  midAutumn: [374],
  chongyang: [28],
  laba: [5],
};

const DAY_GREETINGS: Record<ClawdMode, Record<Slot | 'any', ClawdGreeting[]>> = {
  chat: {
    morning: [{ id: 'chatMorning', animations: [259, 129, 146, 290] }],
    afternoon: [{ id: 'chatAfternoon', animations: [76, 34, 118] }],
    evening: [{ id: 'chatEvening', animations: [396, 35, 389] }],
    night: [{ id: 'chatNight', animations: [109, 388, 389] }],
    any: [
      { id: 'chatIdea', animations: [36, 37, 99] },
      { id: 'chatLearn', animations: [22, 24, 192] },
      { id: 'chatWrite', animations: [162, 151, 169] },
      { id: 'chatHello', animations: [76, 11, 63] },
    ],
  },
  code: {
    morning: [{ id: 'codeMorning', animations: [186, 20, 173] }],
    afternoon: [{ id: 'codeAfternoon', animations: [173, 18, 194] }],
    evening: [{ id: 'codeEvening', animations: [200, 214, 20] }],
    night: [{ id: 'codeNight', animations: [109, 186, 201] }],
    any: [
      { id: 'codeBug', animations: [177, 176, 184] },
      { id: 'codeReview', animations: [195, 193] },
      { id: 'codeTests', animations: [179, 223] },
      { id: 'codeRefactor', animations: [183, 227] },
      { id: 'codeExplore', animations: [338, 305] },
      { id: 'codeHello', animations: [213, 216] },
    ],
  },
};

function slotOf(hour: number): Slot {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/**
 * Used by ClawdGreeting when a new chat opens: a holiday greeting on a holiday (unless turned
 * off), otherwise one for the time of day or a general invitation. `roll` (0 <= roll < 1) picks
 * among the candidates, so a page keeps its greeting across re-renders.
 */
export function pickGreeting(mode: ClawdMode, date: Date, options: { festivals: boolean; roll: number }): ClawdGreeting {
  if (options.festivals) {
    const festival = festivalsOn(date)[0];
    if (festival) return { id: festival, animations: FESTIVAL_GREETINGS[festival] };
  }
  const pool = DAY_GREETINGS[mode];
  const timely = pool[slotOf(date.getHours())];
  // The time-of-day greeting is as likely as all the general invitations together.
  const pick = options.roll < 0.5
    ? timely[Math.floor(options.roll * 2 * timely.length)]
    : pool.any[Math.floor((options.roll - 0.5) * 2 * pool.any.length)];
  return pick ?? timely[0];
}

/** Every greeting id, so tests can check each has its text. */
export const ALL_GREETING_IDS: string[] = [
  ...Object.keys(FESTIVAL_GREETINGS),
  ...(['chat', 'code'] as const).flatMap((mode) => Object.values(DAY_GREETINGS[mode]).flat().map((greeting) => greeting.id)),
];

/** Every animation the greetings use, so tests can check each exists. */
export const ALL_GREETING_ANIMATIONS: number[] = [
  ...Object.values(FESTIVAL_GREETINGS).flat(),
  ...(['chat', 'code'] as const).flatMap((mode) => Object.values(DAY_GREETINGS[mode]).flat().flatMap((greeting) => greeting.animations)),
];

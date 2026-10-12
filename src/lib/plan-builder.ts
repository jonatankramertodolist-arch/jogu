import { addDays, daysBetween, isoWeekday, startOfWeek, todayIso } from './dates';
import { newId } from './store';
import { expectedWeekHours } from './training';
import {
  RACE_TYPE_IS_TRIATHLON,
  SPORTS,
  type AthleteProfile,
  type Goal,
  type Intensity,
  type PhaseName,
  type RaceType,
  type Session,
  type TrainingSport,
  type WeekPlan,
} from './types';

/**
 * Deterministic plan construction. This builds a sound, if generic, periodised
 * plan without any AI involved. It powers the demo plan and acts as the
 * fallback when a model call fails, so the app is never left without a schedule.
 */

/** Share of total weekly hours per discipline, by race type. */
const SPORT_SHARES: Record<RaceType, Record<TrainingSport, number>> = {
  ironman: { swim: 0.2, bike: 0.45, run: 0.28, strength: 0.07 },
  'half-ironman': { swim: 0.22, bike: 0.43, run: 0.28, strength: 0.07 },
  olympic: { swim: 0.26, bike: 0.38, run: 0.29, strength: 0.07 },
  sprint: { swim: 0.28, bike: 0.35, run: 0.3, strength: 0.07 },
  marathon: { swim: 0.02, bike: 0.12, run: 0.78, strength: 0.08 },
  'half-marathon': { swim: 0.02, bike: 0.13, run: 0.77, strength: 0.08 },
  other: { swim: 0.2, bike: 0.4, run: 0.32, strength: 0.08 },
};

const PHASE_FOCUS: Record<PhaseName, string> = {
  base: 'Aerob bas och teknik. Mycket lugn träning, låg andel hårt.',
  build: 'Ökad specifik belastning. Tröskelarbete och längre nyckelpass.',
  peak: 'Tävlingsspecifik träning. Längsta passen och racefart.',
  taper: 'Nedtrappning. Volymen ner, lite fart kvar för att hålla känslan.',
  race: 'Tävlingsvecka. Korta öppnare, vila och förberedelse.',
};

export function weekCount(goal: Goal): number {
  const first = startOfWeek(goal.startDate);
  const last = startOfWeek(goal.raceDate);
  return Math.floor(daysBetween(first, last) / 7) + 1;
}

function phaseForIndex(index: number, total: number): PhaseName {
  if (index === total - 1) return 'race';
  const taperWeeks = total >= 10 ? 2 : total >= 6 ? 1 : 0;
  if (index >= total - 1 - taperWeeks) return 'taper';

  const buildable = total - 1 - taperWeeks;
  const baseEnd = Math.ceil(buildable * 0.45);
  const buildEnd = baseEnd + Math.ceil(buildable * 0.35);
  if (index < baseEnd) return 'base';
  if (index < buildEnd) return 'build';
  return 'peak';
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function splitSportHours(
  totalHours: number,
  raceType: RaceType,
  phase: PhaseName,
): Record<TrainingSport, number> {
  const shares = { ...SPORT_SHARES[raceType] };

  // Strength gets trimmed as the race approaches, and the specific
  // disciplines pick up the freed hours.
  if (phase === 'taper' || phase === 'race') {
    shares.strength = Math.min(shares.strength, 0.04);
  }

  const sum = SPORTS.reduce((acc, sport) => acc + shares[sport], 0);
  const hours: Record<TrainingSport, number> = { swim: 0, bike: 0, run: 0, strength: 0 };
  for (const sport of SPORTS) {
    hours[sport] = roundHalf((totalHours * shares[sport]) / sum);
  }

  // Rounding must not break the rule that the parts add up to the total, so
  // let the biggest discipline absorb the difference.
  const biggest = SPORTS.reduce((best, sport) => (hours[sport] > hours[best] ? sport : best), SPORTS[0]);
  const drift = totalHours - SPORTS.reduce((acc, sport) => acc + hours[sport], 0);
  hours[biggest] = Math.max(0, roundHalf(hours[biggest] + drift));

  return hours;
}

export function buildOutline(
  goal: Goal,
  profile: AthleteProfile,
  options: {
    /**
     * Where the first week should land. Passed in for a follow-up block, so it
     * starts from the volume the athlete has actually been completing rather than
     * from a guess based on their stated budget.
     */
    startHours?: number;
  } = {},
): WeekPlan[] {
  const total = weekCount(goal);
  const firstMonday = startOfWeek(goal.startDate);
  const peak = Math.max(2, profile.weeklyHours);

  const weeks: WeekPlan[] = [];
  // `trend` tracks the last non-recovery week so volume can resume its climb
  // after a down week instead of restarting from the dip.
  let trend = Math.max(2, options.startHours ?? peak * 0.5);

  for (let i = 0; i < total; i += 1) {
    const phase = phaseForIndex(i, total);
    const isRecoveryWeek = phase !== 'taper' && phase !== 'race' && i > 0 && i % 4 === 3;

    let hours: number;
    if (phase === 'race') {
      // Race week is only short openers regardless of how much the athlete
      // normally trains, so it is capped rather than scaled.
      hours = roundHalf(Math.min(peak * 0.3, 3));
    } else if (phase === 'taper') {
      const taperStart = weeks.findIndex((w) => w.phase === 'taper');
      const step = taperStart === -1 ? 0.7 : 0.55;
      hours = roundHalf(trend * step);
    } else if (isRecoveryWeek) {
      hours = roundHalf(trend * 0.72);
    } else {
      const cap = roundHalf(
        phase === 'base' ? peak * 0.8 : phase === 'build' ? peak * 0.95 : peak,
      );
      if (i === 0) {
        hours = roundHalf(trend);
      } else if (trend >= cap) {
        hours = cap;
      } else {
        // Grow by roughly 10 %, rounded down so the step never pushes past the
        // ramp rule, but never below the half-hour step the plan is expressed
        // in, otherwise small weeks would never progress at all.
        const step = Math.max(0.5, Math.floor(trend * 0.1 * 2) / 2);
        hours = Math.min(cap, trend + step);
      }
      trend = hours;
    }

    hours = Math.max(1, hours);

    weeks.push({
      weekStart: addDays(firstMonday, i * 7),
      weekNumber: i + 1,
      phase,
      focus: isRecoveryWeek
        ? 'Återhämtningsvecka. Lägre volym så kroppen hinner ta upp träningen.'
        : PHASE_FOCUS[phase],
      totalHours: hours,
      sportHours: splitSportHours(hours, goal.raceType, phase),
      keySessions: [],
      isRecoveryWeek,
      detailed: false,
    });
  }

  return weeks;
}

interface Slot {
  /** Set for long sessions that belong on a specific day; otherwise balanced. */
  fixedDay: number | null;
  sport: TrainingSport;
  /** Relative weight within that discipline's weekly hours. */
  weight: number;
  intensity: Intensity;
  title: string;
  /**
   * Built from the final duration, so the described workout can never
   * contradict the length the plan actually allocated.
   */
  describe: (minutes: number) => string;
}

/** Splits the week's days into a rest day, long days and ordinary work days. */
function planDays(
  profile: AthleteProfile,
  /** When the week has already started, the weekdays that are still ahead. */
  allowedDays: number[] | null,
): {
  restDays: number[];
  longDays: number[];
  workDays: number[];
} {
  const available = [1, 2, 3, 4, 5, 6, 7].filter(
    (d) => profile.availableDays.includes(d) && (allowedDays == null || allowedDays.includes(d)),
  );
  if (available.length === 0) return { restDays: [1, 2, 3, 4, 5, 6, 7], longDays: [], workDays: [] };

  let longDays = profile.longSessionDays.filter((d) => available.includes(d));
  if (longDays.length === 0) longDays = available.slice(-2);
  longDays = longDays.slice(0, 2);

  const candidates = available.filter((d) => !longDays.includes(d));
  const restDays = [1, 2, 3, 4, 5, 6, 7].filter((d) => !available.includes(d));

  // Everyone needs at least one completely free day each week.
  if (restDays.length === 0 && candidates.length > 1) {
    const preferred = [5, 1, 2].find((d) => candidates.includes(d)) ?? candidates[0];
    restDays.push(preferred);
  }

  const workDays = candidates.filter((d) => !restDays.includes(d));
  return { restDays, longDays, workDays };
}

function roundToFive(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Warm-up, main set and cool-down for a session of the given length. */
function structure(minutes: number): { warm: number; main: number; cool: number } {
  const warm = clamp(roundToFive(minutes * 0.2), 10, 20);
  const cool = clamp(roundToFive(minutes * 0.15), 5, 15);
  return { warm, cool, main: Math.max(10, minutes - warm - cool) };
}

/**
 * How many intervals of `repLength` fit in `main` minutes. The last interval is
 * not followed by a rest, which is why the rest is added before dividing.
 */
function repCount(main: number, repLength: number, rest: number): number {
  return Math.floor((main + rest) / (repLength + rest));
}

/** Rough metres covered in the given minutes, rests included. */
function swimMetres(minutes: number): number {
  return Math.round((minutes * 45) / 50) * 50;
}

/**
 * The shortest a session of each kind is worth doing, and the weekly minutes
 * above which it is worth splitting into more sessions.
 */
const SPLIT_THRESHOLDS: Record<TrainingSport, number[]> = {
  swim: [50, 110],
  bike: [90, 200],
  run: [55, 140],
  strength: [50],
};

/**
 * In triathlon the third run of the week is the short run straight off the
 * bike, which is a key session rather than a luxury. It therefore appears at a
 * lower weekly volume than an ordinary third run would.
 */
const TRIATHLON_RUN_THRESHOLDS = [55, 85];

function sessionCount(sport: TrainingSport, weeklyMinutes: number, isTri: boolean): number {
  const thresholds =
    sport === 'run' && isTri ? TRIATHLON_RUN_THRESHOLDS : SPLIT_THRESHOLDS[sport];
  return thresholds.reduce(
    (count, threshold) => (weeklyMinutes >= threshold ? count + 1 : count),
    1,
  );
}

function bikeTemplates(isTri: boolean, easyWeek: boolean, longDay: number | null): Slot[] {
  if (!isTri) {
    return [
      {
        fixedDay: null,
        sport: 'bike',
        weight: 1,
        intensity: 'easy',
        title: 'Cykel alternativträning',
        describe: () =>
          'Lugn cykling som komplement till löpningen. Håll hög kadens och lågt tryck, det ska vara skonsamt för benen.',
      },
    ];
  }

  return [
    {
      fixedDay: longDay,
      sport: 'bike',
      weight: 0.5,
      intensity: 'endurance',
      title: 'Långpass cykel',
      describe: (minutes) => {
        if (easyWeek || minutes < 75) {
          return 'Jämnt och lugnt i zon 2 hela vägen. Fokus på att sitta bekvämt och hålla kadensen uppe.';
        }
        const { warm, main } = structure(minutes);
        const reps = clamp(repCount(main, 15, 10), 1, 3);
        return `${warm} min lugn uppvärmning, sedan ${reps} x 15 min i racefart med 10 min lugnt emellan. Resten i zon 2. Träna på att äta och dricka precis som du tänker göra på tävling.`;
      },
    },
    {
      fixedDay: null,
      sport: 'bike',
      weight: 0.3,
      intensity: easyWeek ? 'easy' : 'tempo',
      title: easyWeek ? 'Cykel lugnt' : 'Cykel tempo',
      describe: (minutes) => {
        if (easyWeek) return 'Lätt rullning med hög kadens. Inget tryck i benen.';
        const { warm, main, cool } = structure(minutes);
        const repLength = main >= 55 ? 20 : main >= 30 ? 10 : 5;
        const reps = clamp(repCount(main, repLength, 5), 1, 4);
        return `${warm} min uppvärmning, ${reps} x ${repLength} min i tempo med 5 min lugnt emellan, ${cool} min nedvarvning.`;
      },
    },
    {
      fixedDay: null,
      sport: 'bike',
      weight: 0.2,
      intensity: 'recovery',
      title: 'Cykel återhämtning',
      describe: () =>
        'Riktigt lätt hela vägen, hög kadens och lågt motstånd. Ska kännas som vila, inte träning.',
    },
  ];
}

function runTemplates(
  isTri: boolean,
  easyWeek: boolean,
  longRunDay: number | null,
  longBikeDay: number | null,
): Slot[] {
  return [
    {
      fixedDay: longRunDay,
      sport: 'run',
      weight: isTri ? 0.45 : 0.4,
      intensity: 'endurance',
      title: 'Långpass löpning',
      describe: (minutes) => {
        if (easyWeek || minutes < 70) {
          return 'Lugnt tempo i zon 2 hela vägen. Du ska kunna prata utan att flåsa, och avsluta med känslan att du kunnat springa längre.';
        }
        const finish = clamp(roundToFive(minutes * 0.15), 10, 25);
        return `Lugnt tempo i zon 2, men spring de sista ${finish} minuterna i tävlingsfart. Testa din nutrition under passet.`;
      },
    },
    {
      fixedDay: null,
      sport: 'run',
      weight: 0.3,
      intensity: easyWeek ? 'easy' : 'threshold',
      title: easyWeek ? 'Löpning lugnt' : 'Löpning tröskel',
      describe: (minutes) => {
        if (easyWeek) return 'Lugn distans i zon 2. Håll nere farten även om det känns lätt idag.';
        const { warm, main, cool } = structure(minutes);
        const repLength = main >= 40 ? 8 : main >= 24 ? 5 : 3;
        const reps = clamp(repCount(main, repLength, 2), 2, 6);
        return `${warm} min uppvärmning, ${reps} x ${repLength} min på tröskel med 2 min joggvila, ${cool} min nedjogg. Tröskelfarten ska vara ansträngande men jämn hela vägen.`;
      },
    },
    {
      fixedDay: isTri ? longBikeDay : null,
      sport: 'run',
      weight: isTri ? 0.15 : 0.3,
      intensity: 'easy',
      title: isTri ? 'Löpning direkt efter cykeln' : 'Löpning distans',
      describe: () =>
        isTri
          ? 'Börja direkt när du klivit av cykeln. Lugnt tempo, syftet är bara att vänja benen på att springa när de redan är trötta.'
          : 'Lugn distans i zon 2, jämnt tempo hela vägen.',
    },
  ];
}

function swimTemplates(easyWeek: boolean): Slot[] {
  return [
    {
      fixedDay: null,
      sport: 'swim',
      weight: 0.35,
      intensity: 'easy',
      title: 'Simning teknik',
      describe: (minutes) => {
        const { warm, main, cool } = structure(minutes);
        const drills = clamp(Math.round(swimMetres(main) / 50), 4, 20);
        return `${swimMetres(warm)} m lugn uppvärmning, sedan ${drills} x 50 m teknik med kort vila. Växla mellan fokus på armföring, rotation och höga armbågar. ${swimMetres(cool)} m lugnt nedsim.`;
      },
    },
    {
      fixedDay: null,
      sport: 'swim',
      weight: 0.35,
      intensity: easyWeek ? 'easy' : 'threshold',
      title: easyWeek ? 'Simning lugnt' : 'Simning tröskel',
      describe: (minutes) => {
        const { warm, main, cool } = structure(minutes);
        if (easyWeek) {
          return `${swimMetres(warm + main)} m lugn simning med teknikfokus och ${swimMetres(cool)} m nedsim. Ingen press på farten.`;
        }
        const reps = clamp(Math.round(swimMetres(main) / 100), 4, 16);
        return `${swimMetres(warm)} m uppvärmning, ${reps} x 100 m på tröskel med 20 sekunders vila, ${swimMetres(cool)} m nedsim.`;
      },
    },
    {
      fixedDay: null,
      sport: 'swim',
      weight: 0.3,
      intensity: 'endurance',
      title: 'Simning distans',
      describe: (minutes) => {
        const { warm, main, cool } = structure(minutes);
        const repLength = swimMetres(main) >= 1200 ? 400 : 200;
        const reps = clamp(Math.round(swimMetres(main) / repLength), 2, 8);
        return `${swimMetres(warm)} m uppvärmning, ${reps} x ${repLength} m i lugnt men jämnt tempo med 30 sekunders vila, ${swimMetres(cool)} m nedsim. Öva på att hålla samma fart hela vägen.`;
      },
    },
  ];
}

function strengthTemplates(): Slot[] {
  return [
    {
      fixedDay: null,
      sport: 'strength',
      weight: 0.5,
      intensity: 'easy',
      title: 'Styrka',
      describe: (minutes) =>
        `Knäböj, utfall, höftlyft och bålstabilitet i ${minutes >= 45 ? 4 : 3} set. Kontrollerat utförande, tyngdpunkt på teknik framför vikt.`,
    },
    {
      fixedDay: null,
      sport: 'strength',
      weight: 0.5,
      intensity: 'easy',
      title: 'Styrka och rörlighet',
      describe: (minutes) =>
        `Enbensövningar, vadpress och bål i ${minutes >= 45 ? 4 : 3} set, sedan rörlighet för höft, vader och axlar.`,
    },
  ];
}

type PlacedSlot = Slot & { day: number };

/**
 * Spreads the sessions that have no fixed day across the available days, always
 * choosing the least busy one, so no single day ends up carrying the week.
 */
function assignDays(slots: Slot[], workDays: number[], longDays: number[]): PlacedSlot[] {
  if (workDays.length === 0 && longDays.length === 0) return [];

  const load = new Map<number, number>();
  for (const day of workDays) load.set(day, 0);

  const placed: PlacedSlot[] = [];

  for (const slot of slots) {
    if (slot.fixedDay != null) {
      placed.push({ ...slot, day: slot.fixedDay });
      if (load.has(slot.fixedDay)) load.set(slot.fixedDay, load.get(slot.fixedDay)! + 1);
      continue;
    }

    const target = workDays.reduce(
      (best, day) => (load.get(day)! < load.get(best)! ? day : best),
      workDays[0] ?? longDays[0],
    );
    if (target == null) continue;
    load.set(target, (load.get(target) ?? 0) + 1);
    placed.push({ ...slot, day: target });
  }

  return placed;
}

/**
 * Turns one outlined week into concrete sessions. The number of sessions per
 * discipline follows from how many hours that discipline has, so a week with
 * little swimming gets one proper session rather than three token ones.
 */
export function buildWeekSessions(
  week: WeekPlan,
  goal: Goal,
  profile: AthleteProfile,
  source: Session['source'] = 'demo',
  today = todayIso(),
): Session[] {
  if (week.phase === 'race') return buildRaceWeekSessions(week, goal, profile, source);

  // A week that is already under way gets only the days that remain, and its
  // hours shrink to match. Otherwise the builder would put sessions on days
  // that have already passed.
  const started = today > week.weekStart && today <= addDays(week.weekStart, 6);
  const remainingDays = started
    ? [1, 2, 3, 4, 5, 6, 7].filter((d) => addDays(week.weekStart, d - 1) >= today)
    : null;
  const budgeted = started ? scaleWeek(week, expectedWeekHours(week, profile, today)) : week;

  const { longDays, workDays } = planDays(profile, remainingDays);
  const isTri = RACE_TYPE_IS_TRIATHLON[goal.raceType];
  const easyWeek = week.isRecoveryWeek || week.phase === 'taper';

  const longBikeDay = longDays[0] ?? workDays[0] ?? null;
  const longRunDay = longDays[1] ?? longBikeDay;

  const templates: Record<TrainingSport, Slot[]> = {
    bike: bikeTemplates(isTri, easyWeek, longBikeDay),
    run: runTemplates(isTri, easyWeek, longRunDay, longBikeDay),
    swim: swimTemplates(easyWeek),
    strength: strengthTemplates(),
  };

  const chosen: Slot[] = [];
  for (const sport of SPORTS) {
    const weeklyMinutes = budgeted.sportHours[sport] * 60;
    if (weeklyMinutes < 15) continue;
    chosen.push(...templates[sport].slice(0, sessionCount(sport, weeklyMinutes, isTri)));
  }

  const placed = assignDays(chosen, workDays, longDays);
  const durations = splitMinutes(placed, budgeted);

  const perDayCount = new Map<number, number>();
  const sessions: Session[] = [];

  placed.forEach((slot, index) => {
    const minutes = durations[index];
    if (minutes < 15) return;

    const order = perDayCount.get(slot.day) ?? 0;
    perDayCount.set(slot.day, order + 1);

    sessions.push({
      id: newId(),
      date: addDays(week.weekStart, slot.day - 1),
      sport: slot.sport,
      title: slot.title,
      intensity: slot.intensity,
      durationMin: minutes,
      distanceKm: null,
      description: slot.describe(minutes),
      status: 'planned',
      order,
      source,
    });
  });

  return sessions;
}

/** The same week resized to a smaller total, keeping the discipline balance. */
function scaleWeek(week: WeekPlan, totalHours: number): WeekPlan {
  if (week.totalHours <= 0 || totalHours >= week.totalHours) return week;
  const factor = totalHours / week.totalHours;
  return {
    ...week,
    totalHours,
    sportHours: {
      swim: week.sportHours.swim * factor,
      bike: week.sportHours.bike * factor,
      run: week.sportHours.run * factor,
      strength: week.sportHours.strength * factor,
    },
  };
}

/**
 * Splits each discipline's weekly minutes across its sessions. The longest
 * session absorbs the rounding remainder so the week adds up to exactly the
 * hours the outline promised.
 */
function splitMinutes(placed: PlacedSlot[], week: WeekPlan): number[] {
  const minutes = new Array<number>(placed.length).fill(0);

  for (const sport of SPORTS) {
    const indices = placed
      .map((slot, index) => ({ slot, index }))
      .filter((entry) => entry.slot.sport === sport);
    if (indices.length === 0) continue;

    const target = Math.round(week.sportHours[sport] * 60);
    const weightSum = indices.reduce((sum, entry) => sum + entry.slot.weight, 0) || 1;

    for (const entry of indices) {
      minutes[entry.index] = roundToFive((target * entry.slot.weight) / weightSum);
    }

    const longest = indices.reduce(
      (best, entry) => (minutes[entry.index] > minutes[best.index] ? entry : best),
      indices[0],
    );
    const drift = target - indices.reduce((sum, entry) => sum + minutes[entry.index], 0);
    minutes[longest.index] = Math.max(15, minutes[longest.index] + drift);

    // A session too short to be worth doing hands its minutes to the longest
    // one instead of quietly disappearing from the week.
    for (const entry of indices) {
      if (entry.index === longest.index || minutes[entry.index] >= 15) continue;
      minutes[longest.index] += minutes[entry.index];
      minutes[entry.index] = 0;
    }
  }

  return minutes;
}

function buildRaceWeekSessions(
  week: WeekPlan,
  goal: Goal,
  profile: AthleteProfile,
  source: Session['source'],
): Session[] {
  const sessions: Session[] = [];
  const raceDate = goal.raceDate;
  const isTri = RACE_TYPE_IS_TRIATHLON[goal.raceType];

  const opener = (dayOffset: number, sport: TrainingSport, minutes: number, title: string, description: string) => {
    // Walk backwards to the nearest day the athlete can actually train on.
    let date: string | null = null;
    for (let shift = 0; shift < 3; shift += 1) {
      const candidate = addDays(raceDate, dayOffset - shift);
      if (candidate < week.weekStart) break;
      const weekday = isoWeekday(candidate);
      if (profile.availableDays.includes(weekday) && !sessions.some((s) => s.date === candidate)) {
        date = candidate;
        break;
      }
    }
    if (!date) return;

    sessions.push({
      id: newId(),
      date,
      sport,
      title,
      intensity: 'easy',
      durationMin: minutes,
      distanceKm: null,
      description,
      status: 'planned',
      order: sessions.filter((s) => s.date === date).length,
      source,
    });
  };

  opener(-5, 'bike', 60, 'Cykel öppnare', 'Lugnt med 4x1 min i racefart för att hålla känslan. Kontrollera cykeln.');
  if (isTri) {
    opener(-4, 'swim', 30, 'Simning kort', 'Lugnt, känn på vattnet. Testa våtdräkten om tävlingen är i öppet vatten.');
  }
  opener(-3, 'run', 30, 'Löpning öppnare', 'Lugnt med 4x30 s i racefart. Inget mer.');
  opener(-1, 'bike', 20, 'Kort avspark', 'Bara 20 min lugnt för att lösa upp benen. Packa väskan.');

  sessions.push({
    id: newId(),
    date: raceDate,
    sport: isTri ? 'multi' : 'run',
    title: goal.raceName || 'Tävling',
    intensity: 'race',
    durationMin: estimateRaceMinutes(goal.raceType, profile),
    distanceKm: null,
    description:
      'Tävlingsdag. Håll din plan för fart och nutrition, särskilt de första timmarna när det känns lätt.',
    status: 'planned',
    order: 0,
    source,
  });

  return sessions;
}

function estimateRaceMinutes(raceType: RaceType, profile: AthleteProfile): number {
  const base: Record<RaceType, number> = {
    ironman: 780,
    'half-ironman': 360,
    olympic: 165,
    sprint: 90,
    marathon: 255,
    'half-marathon': 115,
    other: 180,
  };
  const factor =
    profile.experience === 'advanced' ? 0.85 : profile.experience === 'beginner' ? 1.15 : 1;
  return Math.round((base[raceType] * factor) / 5) * 5;
}

/** A complete ready-made plan, used to show the app before any AI is connected. */
export function buildDemoPlan(): {
  goal: Goal;
  profile: AthleteProfile;
  weeks: WeekPlan[];
  sessions: Session[];
  summary: string;
} {
  const today = new Date();
  const start = startOfWeek(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  );
  // A 24 week build is the classic Ironman preparation length.
  const raceDate = addDays(start, 24 * 7 - 1);

  const goal: Goal = {
    raceName: 'Ironman Kalmar (demo)',
    raceType: 'ironman',
    raceDate,
    startDate: start,
    goalTime: 'Under 12 timmar',
    notes: 'Demoschema för att visa hur appen fungerar.',
  };

  const profile: AthleteProfile = {
    name: '',
    birthYear: 1990,
    weightKg: 78,
    weeklyHours: 12,
    availableDays: [1, 2, 3, 4, 5, 6, 7],
    longSessionDays: [6, 7],
    experience: 'intermediate',
    swimBackground: 'Simmar 1:50/100 m, ovan i öppet vatten.',
    bikeBackground: 'Cyklar regelbundet, tröskeleffekt runt 240 W.',
    runBackground: 'Har sprungit marathon på 3:45.',
    injuries: 'Känslig vänster hälsena vid snabb ökning av löpvolym.',
    notes: 'Demoprofil.',
  };

  const weeks = buildOutline(goal, profile);
  const sessions: Session[] = [];

  // Detail the first four weeks, which is the same rolling window the real
  // plan uses.
  weeks.slice(0, 4).forEach((week) => {
    week.detailed = true;
    sessions.push(...buildWeekSessions(week, goal, profile, 'demo'));
  });

  return {
    goal,
    profile,
    weeks,
    sessions,
    summary:
      'Ett 24 veckor långt Ironman-bygge med bred aerob bas, tre uppbyggnadsblock med återhämtningsvecka var fjärde vecka, och tre veckors nedtrappning. Cykeln får mest tid eftersom den är längst i loppet, och löpvolymen ökar försiktigt av hänsyn till hälsenan.',
  };
}

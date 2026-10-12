import { addDays, daysBetween, isoWeekday, startOfWeek, todayIso } from './dates';
import {
  HARD_INTENSITIES,
  INTENSITY_FACTOR,
  SPORTS,
  type AppState,
  type AthleteProfile,
  type Feeling,
  type Session,
  type SessionLog,
  type TrainingSport,
  type WeekPlan,
} from './types';

/**
 * Every number the coach reasons about is computed here rather than by the
 * model. Deterministic maths keeps the plan trustworthy and means the prompt
 * can stay short.
 */

const FEELING_SCORE: Record<Feeling, number> = {
  exhausted: 1,
  tired: 2,
  ok: 3,
  good: 4,
  strong: 5,
};

export function sessionLoad(session: Session): number {
  if (session.sport === 'rest') return 0;
  return Math.round(session.durationMin * INTENSITY_FACTOR[session.intensity]);
}

export function loggedLoad(session: Session, log: SessionLog | undefined): number {
  const minutes = log?.actualDurationMin ?? session.durationMin;
  if (session.sport === 'rest') return 0;
  // A logged RPE is better evidence of intensity than the plan's label.
  const factor = log?.rpe ? 0.45 + log.rpe * 0.09 : INTENSITY_FACTOR[session.intensity];
  return Math.round(minutes * factor);
}

export interface WeekStats {
  weekStart: string;
  plannedMin: number;
  plannedLoad: number;
  completedMin: number;
  completedLoad: number;
  sessionCount: number;
  hardSessionCount: number;
  restDayCount: number;
  minutesBySport: Record<TrainingSport, number>;
  completedBySport: Record<TrainingSport, number>;
}

function emptySportMinutes(): Record<TrainingSport, number> {
  return { swim: 0, bike: 0, run: 0, strength: 0 };
}

export function weekStats(sessions: Session[], logs: Record<string, SessionLog>, weekStart: string): WeekStats {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = sessions.filter((s) => s.date >= weekStart && s.date <= weekEnd);
  const stats: WeekStats = {
    weekStart,
    plannedMin: 0,
    plannedLoad: 0,
    completedMin: 0,
    completedLoad: 0,
    sessionCount: 0,
    hardSessionCount: 0,
    restDayCount: 0,
    minutesBySport: emptySportMinutes(),
    completedBySport: emptySportMinutes(),
  };

  for (const session of inWeek) {
    if (session.sport === 'rest') continue;
    stats.sessionCount += 1;
    stats.plannedMin += session.durationMin;
    stats.plannedLoad += sessionLoad(session);
    if (session.sport !== 'multi') stats.minutesBySport[session.sport] += session.durationMin;
    if (HARD_INTENSITIES.includes(session.intensity)) stats.hardSessionCount += 1;
    if (session.status === 'done') {
      const log = logs[session.id];
      const minutes = log?.actualDurationMin ?? session.durationMin;
      stats.completedMin += minutes;
      stats.completedLoad += loggedLoad(session, log);
      if (session.sport !== 'multi') stats.completedBySport[session.sport] += minutes;
    }
  }

  for (let i = 0; i < 7; i += 1) {
    const day = addDays(weekStart, i);
    const training = inWeek.filter((s) => s.date === day && s.sport !== 'rest');
    if (training.length === 0) stats.restDayCount += 1;
  }

  return stats;
}

/** Rolling load over the last `days` days, based on what was actually done. */
export function recentLoad(
  sessions: Session[],
  logs: Record<string, SessionLog>,
  days: number,
  today = todayIso(),
): number {
  const from = addDays(today, -days + 1);
  return sessions
    .filter((s) => s.date >= from && s.date <= today && s.status === 'done')
    .reduce((sum, s) => sum + loggedLoad(s, logs[s.id]), 0);
}

export interface FormSnapshot {
  /** Load over the last 7 days. */
  acuteLoad: number;
  /** Average weekly load over the last 28 days. */
  chronicLoad: number;
  /**
   * Acute divided by chronic. Above ~1.4 is where injury risk climbs, below
   * ~0.8 means fitness is being lost.
   */
  loadRatio: number | null;
  avgRpe7d: number | null;
  avgFeeling7d: number | null;
  /** Consecutive most recent logs where the athlete felt tired or worse. */
  consecutiveRoughSessions: number;
  completionRate14d: number | null;
  daysSinceRest: number;
}

export function formSnapshot(
  sessions: Session[],
  logs: Record<string, SessionLog>,
  today = todayIso(),
): FormSnapshot {
  const acuteLoad = recentLoad(sessions, logs, 7, today);
  const load28 = recentLoad(sessions, logs, 28, today);
  const chronicLoad = Math.round(load28 / 4);

  // The acute/chronic ratio only means something once there is training behind
  // the last seven days to compare against. Without that guard, a single logged
  // session produces an alarming number out of nothing.
  const hasBaseline = sessions.some(
    (s) =>
      s.status === 'done' && s.date >= addDays(today, -27) && s.date <= addDays(today, -7),
  );

  const from7 = addDays(today, -6);
  const recentLogs = sessions
    .filter((s) => s.date >= from7 && s.date <= today && logs[s.id])
    .map((s) => logs[s.id]);

  const rpes = recentLogs.map((l) => l.rpe).filter((v): v is number => v != null);
  const feelings = recentLogs.map((l) => l.feeling).filter((v): v is Feeling => v != null);

  // Walk backwards through all logs to see how long a rough patch has lasted.
  const chronological = sessions
    .filter((s) => logs[s.id]?.feeling)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  let consecutiveRoughSessions = 0;
  for (let i = chronological.length - 1; i >= 0; i -= 1) {
    const feeling = logs[chronological[i].id].feeling!;
    if (feeling === 'tired' || feeling === 'exhausted') consecutiveRoughSessions += 1;
    else break;
  }

  const from14 = addDays(today, -13);
  const due = sessions.filter(
    (s) => s.date >= from14 && s.date <= today && s.sport !== 'rest',
  );
  const done = due.filter((s) => s.status === 'done');

  let daysSinceRest = 0;
  for (let i = 0; i < 21; i += 1) {
    const day = addDays(today, -i);
    const trained = sessions.some(
      (s) => s.date === day && s.sport !== 'rest' && s.status === 'done',
    );
    if (trained) daysSinceRest += 1;
    else break;
  }

  return {
    acuteLoad,
    chronicLoad,
    loadRatio:
      hasBaseline && chronicLoad > 0 ? Math.round((acuteLoad / chronicLoad) * 100) / 100 : null,
    avgRpe7d: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null,
    avgFeeling7d: feelings.length
      ? Math.round(
          (feelings.reduce((a, f) => a + FEELING_SCORE[f], 0) / feelings.length) * 10,
        ) / 10
      : null,
    consecutiveRoughSessions,
    completionRate14d: due.length ? Math.round((done.length / due.length) * 100) : null,
    daysSinceRest,
  };
}

/**
 * Week-by-week stats ending with the current week, oldest first. Used for the
 * history view so the athlete can see the same trend the coach reasons about.
 */
export function weeklyHistory(
  sessions: Session[],
  logs: Record<string, SessionLog>,
  weeks: number,
  today = todayIso(),
): WeekStats[] {
  const thisMonday = startOfWeek(today);
  return Array.from({ length: weeks }, (_, index) =>
    weekStats(sessions, logs, addDays(thisMonday, -(weeks - 1 - index) * 7)),
  );
}

/** Logged sessions in the given range, most recent first. */
export function loggedSessions(
  sessions: Session[],
  logs: Record<string, SessionLog>,
  from: string,
  to: string,
): Session[] {
  return sessions
    .filter((s) => s.date >= from && s.date <= to && logs[s.id])
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : b.order - a.order));
}

export function sessionsOnDate(sessions: Session[], date: string): Session[] {
  return sessions
    .filter((s) => s.date === date)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'sv'));
}

export function sessionsInRange(sessions: Session[], from: string, to: string): Session[] {
  return sessions
    .filter((s) => s.date >= from && s.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
}

export function nextUpcomingSession(sessions: Session[], today = todayIso()): Session | null {
  const upcoming = sessions
    .filter((s) => s.date >= today && s.status === 'planned' && s.sport !== 'rest')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  return upcoming[0] ?? null;
}

export function currentWeek(plan: { weeks: WeekPlan[] } | null, today = todayIso()): WeekPlan | null {
  if (!plan) return null;
  const monday = startOfWeek(today);
  return plan.weeks.find((w) => w.weekStart === monday) ?? null;
}

export function daysToRace(raceDate: string, today = todayIso()): number {
  return daysBetween(today, raceDate);
}

/** The last date that concrete sessions exist for. */
export function detailedThrough(sessions: Session[]): string | null {
  if (sessions.length === 0) return null;
  return sessions.reduce((max, s) => (s.date > max ? s.date : max), sessions[0].date);
}

/**
 * Weeks that still need concrete sessions inside the rolling detail window.
 * The plan stays outlined far ahead but detailed only near-term, which is both
 * cheaper and closer to how a coach actually works.
 */
export function weeksNeedingDetail(state: AppState, today = todayIso()): WeekPlan[] {
  if (!state.plan) return [];
  const horizon = addDays(today, state.settings.detailWindowDays);
  const thisMonday = startOfWeek(today);
  return state.plan.weeks.filter(
    (week) => !week.detailed && week.weekStart >= thisMonday && week.weekStart <= horizon,
  );
}

/**
 * How many hours can realistically still be placed in a week. A week that has
 * already started only has its remaining trainable days left, so holding it to
 * the outline's full budget would either cram the rest of the week or make the
 * week look like it fell short.
 */
export function expectedWeekHours(
  week: WeekPlan,
  profile: AthleteProfile,
  today = todayIso(),
): number {
  if (today <= week.weekStart || today > addDays(week.weekStart, 6)) return week.totalHours;

  const trainableFrom = (from: string): number => {
    let count = 0;
    for (let i = 0; i < 7; i += 1) {
      const day = addDays(week.weekStart, i);
      if (day >= from && profile.availableDays.includes(isoWeekday(day))) count += 1;
    }
    return count;
  };

  const whole = trainableFrom(week.weekStart);
  if (whole === 0) return week.totalHours;
  return Math.round(((week.totalHours * trainableFrom(today)) / whole) * 2) / 2;
}

export function totalPlannedHours(weeks: WeekPlan[]): number {
  return Math.round(weeks.reduce((sum, w) => sum + w.totalHours, 0));
}

export function peakWeek(weeks: WeekPlan[]): WeekPlan | null {
  if (weeks.length === 0) return null;
  return weeks.reduce((best, w) => (w.totalHours > best.totalHours ? w : best), weeks[0]);
}

export function sportShare(weeks: WeekPlan[]): Record<TrainingSport, number> {
  const totals = emptySportMinutes();
  for (const week of weeks) {
    for (const sport of SPORTS) totals[sport] += week.sportHours[sport] ?? 0;
  }
  const sum = SPORTS.reduce((acc, sport) => acc + totals[sport], 0);
  if (sum === 0) return totals;
  const share = emptySportMinutes();
  for (const sport of SPORTS) share[sport] = Math.round((totals[sport] / sum) * 100);
  return share;
}

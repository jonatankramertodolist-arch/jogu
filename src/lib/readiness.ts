import { addDays, startOfWeek, todayIso } from './dates';
import { formSnapshot, weekStats, type FormSnapshot, type WeekStats } from './training';
import type { AppState, Session, SessionLog } from './types';
import { MAX_WEEKLY_RAMP } from './validation';

/**
 * Decides whether the next block should push, hold, ease or recover.
 *
 * This is the part that stops a plan from grinding somebody down. A schedule that
 * only ever climbs looks impressive and is the single most reliable way to end up
 * injured or so flat that training stops altogether. So before anything is built,
 * the evidence already collected gets a vote: how hard the sessions felt, how many
 * were actually finished, and how long it has been since a genuine day off.
 *
 * Deliberately deterministic. The AI writes the sessions, but how much load the
 * athlete is handed is arithmetic the athlete can check, and it cannot change its
 * mind between two identical weeks.
 */

export type ReadinessVerdict = 'push' | 'hold' | 'ease' | 'recover';

export interface Readiness {
  verdict: ReadinessVerdict;
  /** What to multiply recent weekly volume by. 1.08 means eight percent more. */
  volumeFactor: number;
  /** The same figure as a signed percentage, for showing. */
  volumePercent: number;
  /** Hard sessions allowed per week under this verdict. */
  maxHardSessions: number;
  /** Why, strongest reason first, in words the athlete would use. */
  reasons: string[];
  /** True when too little has been logged to judge. Then the verdict holds. */
  uncertain: boolean;
  /** Sum of the signals. Negative means back off. Kept for the history view. */
  score: number;
}

export interface VolumeBaseline {
  /** Hours actually completed in a typical recent week. What to build from. */
  completedHoursPerWeek: number;
  /** Hours planned over the same weeks, so the gap is visible. */
  plannedHoursPerWeek: number;
  /** Full weeks behind this figure. */
  weeksConsidered: number;
  /** True when there is not enough finished training to build on. */
  uncertain: boolean;
}

export const VERDICT_LABELS: Record<ReadinessVerdict, string> = {
  push: 'Pressa på',
  hold: 'Håll nivån',
  ease: 'Lätta något',
  recover: 'Återhämta',
};

export const VERDICT_BLURBS: Record<ReadinessVerdict, string> = {
  push: 'Du har marginal. Nästa block ökar.',
  hold: 'Ligg kvar på samma volym och låt kroppen hinna med.',
  ease: 'Dra ner en aning så du inte gräver dig djupare.',
  recover: 'Nästa block är en återhämtningsvecka. Volymen ner tydligt.',
};

/** Fewer logged sessions than this in a fortnight is too little to judge on. */
const MIN_LOGS_TO_JUDGE = 3;

interface Signal {
  weight: number;
  reason: string;
}

/**
 * How hard the sessions have felt. Perceived exertion is the single most useful
 * thing an athlete can report, because it already accounts for sleep, stress and
 * everything else a plan cannot see.
 */
function rpeSignal(form: FormSnapshot): Signal | null {
  if (form.avgRpe7d === null) return null;
  const rpe = form.avgRpe7d;
  if (rpe >= 8) return { weight: -2, reason: `Passen har känts tunga, snitt ${rpe} av 10.` };
  if (rpe >= 7) return { weight: -1, reason: `Ansträngningen ligger lite högt, snitt ${rpe} av 10.` };
  if (rpe <= 4.5) return { weight: 1, reason: `Passen har känts lätta, snitt ${rpe} av 10.` };
  return null;
}

function feelingSignal(form: FormSnapshot): Signal | null {
  if (form.avgFeeling7d === null) return null;
  const feeling = form.avgFeeling7d;
  if (feeling <= 2) return { weight: -2, reason: 'Du har mest känt dig trött eller slutkörd.' };
  if (feeling <= 2.6) return { weight: -1, reason: 'Känslan efter passen har dragit mot trött.' };
  if (feeling >= 4) return { weight: 1, reason: 'Du har känt dig pigg eller stark efter passen.' };
  return null;
}

function roughPatchSignal(form: FormSnapshot): Signal | null {
  const rough = form.consecutiveRoughSessions;
  if (rough >= 3) return { weight: -2, reason: `${rough} pass i rad har känts tunga.` };
  if (rough === 2) return { weight: -1, reason: 'De två senaste passen kändes tunga.' };
  return null;
}

/**
 * Recent load against the load the body is used to. Well above one means the jump
 * is bigger than what has been built up to, which is where injuries cluster.
 */
function loadRatioSignal(form: FormSnapshot): Signal | null {
  if (form.loadRatio === null) return null;
  const ratio = form.loadRatio;
  if (ratio >= 1.4) {
    return { weight: -2, reason: `Senaste veckan är ${ratio} gånger din vanliga belastning.` };
  }
  if (ratio >= 1.25) return { weight: -1, reason: 'Belastningen har klättrat snabbt.' };
  if (ratio <= 0.8) return { weight: 1, reason: 'Belastningen har legat lågt en tid.' };
  return null;
}

/** Whether the plan is actually being carried out. A plan half done is too big. */
function completionSignal(form: FormSnapshot): Signal | null {
  if (form.completionRate14d === null) return null;
  const rate = form.completionRate14d;
  if (rate < 60) {
    return { weight: -2, reason: `Du har hunnit ${rate} % av passen. Schemat är för stort.` };
  }
  if (rate < 80) return { weight: -1, reason: `Du har hunnit ${rate} % av passen.` };
  if (rate >= 95) return { weight: 1, reason: 'Du har gjort så gott som allt i schemat.' };
  return null;
}

function restSignal(form: FormSnapshot): Signal | null {
  const days = form.daysSinceRest;
  if (days >= 10) return { weight: -2, reason: `${days} dagar i rad utan en fri dag.` };
  if (days >= 7) return { weight: -1, reason: `${days} dagar i rad utan en fri dag.` };
  return null;
}

/**
 * Ambition only sets how big a step to take when the evidence already says there
 * is room. It cannot turn a verdict of "recover" into more training.
 */
function rampFor(ambition: number): number {
  const clamped = Math.min(100, Math.max(0, ambition));
  const gentlest = 0.03;
  const boldest = MAX_WEEKLY_RAMP - 1;
  return gentlest + (boldest - gentlest) * (clamped / 100);
}

function hardSessionsFor(verdict: ReadinessVerdict, ambition: number): number {
  switch (verdict) {
    case 'recover':
      return 0;
    case 'ease':
      return 1;
    case 'hold':
      return ambition >= 70 ? 3 : 2;
    case 'push':
      return ambition >= 40 ? 3 : 2;
  }
}

function countRecentLogs(
  sessions: Session[],
  logs: Record<string, SessionLog>,
  today: string,
): number {
  const from = addDays(today, -13);
  return sessions.filter((s) => s.date >= from && s.date <= today && logs[s.id]).length;
}

export function assessReadiness(
  state: AppState,
  today = todayIso(),
): Readiness {
  const form = formSnapshot(state.sessions, state.logs, today);
  const ambition = state.settings.ambition;
  const loggedCount = countRecentLogs(state.sessions, state.logs, today);

  // Without logs there is nothing to read. Holding is the honest answer: guessing
  // "push" from silence is exactly how a plan runs somebody into the ground.
  if (loggedCount < MIN_LOGS_TO_JUDGE) {
    return {
      verdict: 'hold',
      volumeFactor: 1,
      volumePercent: 0,
      maxHardSessions: 2,
      reasons:
        loggedCount === 0
          ? ['Inga loggade pass än, så jag har inget att gå på. Logga passen så anpassas nästa block.']
          : [`Bara ${loggedCount} loggade pass senaste två veckorna. Jag behöver fler för att våga ändra.`],
      uncertain: true,
      score: 0,
    };
  }

  const signals = [
    rpeSignal(form),
    feelingSignal(form),
    roughPatchSignal(form),
    loadRatioSignal(form),
    completionSignal(form),
    restSignal(form),
  ].filter((signal): signal is Signal => signal !== null);

  const score = signals.reduce((sum, signal) => sum + signal.weight, 0);

  const verdict: ReadinessVerdict =
    score <= -4 ? 'recover' : score <= -2 ? 'ease' : score <= 1 ? 'hold' : 'push';

  const volumeFactor =
    verdict === 'recover' ? 0.6 : verdict === 'ease' ? 0.85 : verdict === 'hold' ? 1 : 1 + rampFor(ambition);

  // Strongest first, so the one sentence shown in a summary is the one that
  // actually decided it.
  const reasons = signals
    .slice()
    .sort((a, b) => a.weight - b.weight)
    .map((signal) => signal.reason);

  return {
    verdict,
    volumeFactor,
    volumePercent: Math.round((volumeFactor - 1) * 100),
    maxHardSessions: hardSessionsFor(verdict, ambition),
    reasons,
    uncertain: false,
    score,
  };
}

/**
 * What the athlete has actually been managing per week.
 *
 * Uses completed rather than planned hours, because building on a figure that was
 * never reached is how a plan drifts further and further from reality. The middle
 * of the last three full weeks is taken rather than the average, so one holiday
 * week or one heroic week does not set the level.
 */
export function volumeBaseline(
  sessions: Session[],
  logs: Record<string, SessionLog>,
  today = todayIso(),
): VolumeBaseline {
  const thisMonday = startOfWeek(today);
  const weeks: WeekStats[] = [1, 2, 3].map((back) =>
    weekStats(sessions, logs, addDays(thisMonday, -back * 7)),
  );

  const withTraining = weeks.filter((week) => week.completedMin > 0);

  if (withTraining.length === 0) {
    return {
      completedHoursPerWeek: 0,
      plannedHoursPerWeek: Math.round((weeks[0]?.plannedMin ?? 0) / 6) / 10,
      weeksConsidered: 0,
      uncertain: true,
    };
  }

  const completed = withTraining.map((week) => week.completedMin).sort((a, b) => a - b);
  const middle = completed[Math.floor(completed.length / 2)];

  const plannedTotal = withTraining.reduce((sum, week) => sum + week.plannedMin, 0);

  return {
    completedHoursPerWeek: Math.round((middle / 60) * 10) / 10,
    plannedHoursPerWeek: Math.round((plannedTotal / withTraining.length / 60) * 10) / 10,
    weeksConsidered: withTraining.length,
    // One week is a data point, not a pattern.
    uncertain: withTraining.length < 2,
  };
}

export interface NextBlockSuggestion {
  readiness: Readiness;
  baseline: VolumeBaseline;
  /** Weekly hours suggested for the coming block. */
  suggestedHours: number;
  /** The ceiling the athlete set for themselves. */
  budgetHours: number;
  /** True when the suggestion was cut back to fit that ceiling. */
  cappedByBudget: boolean;
  /** One sentence explaining the number, ready to show. */
  explanation: string;
}

/**
 * Turns the verdict and the completed volume into an actual number of hours, and
 * says out loud where it came from. Presented before anything is built, because
 * being handed a plan whose size you never agreed to is what makes people quit.
 */
export function suggestNextBlock(state: AppState, today = todayIso()): NextBlockSuggestion {
  const readiness = assessReadiness(state, today);
  const baseline = volumeBaseline(state.sessions, state.logs, today);
  const budgetHours = state.profile.weeklyHours;

  // With nothing completed to build on, the athlete's own budget is the only
  // honest starting point.
  const from = baseline.completedHoursPerWeek > 0 ? baseline.completedHoursPerWeek : budgetHours;
  const raw = from * readiness.volumeFactor;
  const suggestedHours = Math.round(Math.min(raw, budgetHours) * 2) / 2;
  const cappedByBudget = raw > budgetHours + 0.25;

  const explanation = (() => {
    if (baseline.completedHoursPerWeek === 0) {
      return `Du har inga genomförda veckor bakom dig, så jag utgår från dina ${budgetHours} h i veckan.`;
    }
    const direction =
      readiness.volumePercent > 0
        ? `plus ${readiness.volumePercent} %`
        : readiness.volumePercent < 0
          ? `minus ${Math.abs(readiness.volumePercent)} %`
          : 'oförändrat';
    const base = `Du har genomfört ${baseline.completedHoursPerWeek} h i veckan de senaste ${baseline.weeksConsidered} veckorna. Nästa block läggs på ${suggestedHours} h, alltså ${direction}.`;
    return cappedByBudget
      ? `${base} Ökningen är kapad av din egen gräns på ${budgetHours} h.`
      : base;
  })();

  return { readiness, baseline, suggestedHours, budgetHours, cappedByBudget, explanation };
}

import { addDays, formatWeekRange, isoWeekday, startOfWeek, todayIso } from './dates';
import { expectedWeekHours, weekStats } from './training';
import {
  HARD_INTENSITIES,
  type AthleteProfile,
  type Goal,
  type Session,
  type SessionLog,
  type WeekPlan,
} from './types';

/**
 * Training-science guardrails. The model proposes, these rules decide whether a
 * proposal is allowed through. Errors are sent back to the model for another
 * attempt; warnings are shown to the athlete but not blocking.
 */

export interface Issue {
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Largest week-over-week volume increase we accept, as a ratio. Exported so the
 * coach's prompt can state the same figure it is judged against: the two used to
 * be written out separately, and disagreed.
 */
export const MAX_WEEKLY_RAMP = 1.1;
/** The same rule as a percentage, for anything shown or said to the athlete. */
export const MAX_WEEKLY_RAMP_PERCENT = Math.round((MAX_WEEKLY_RAMP - 1) * 100);
/** Smallest increase always allowed, since plans use half-hour steps. */
const MIN_RAMP_ALLOWANCE_HOURS = 0.5;
/** How much the athlete's stated weekly budget may be exceeded. */
const MAX_BUDGET_OVERSHOOT = 1.2;
/** A recovery week must appear at least this often. */
const MAX_WEEKS_WITHOUT_RECOVERY = 4;
/** Race week volume as a share of the peak week. */
const MAX_RACE_WEEK_SHARE = 0.6;

/**
 * An upper bound on where a plan may start, derived from what the athlete has
 * actually been completing. Without it the coach is free to open a follow-up
 * block above the volume that was already proving too much.
 */
export interface PlanCeiling {
  /** The first week may not exceed this many hours. */
  firstWeekHours: number;
  /** Where the figure came from, so the message can explain itself. */
  because: string;
}

export function validateWeeks(
  weeks: WeekPlan[],
  profile: AthleteProfile,
  goal: Goal,
  ceiling?: PlanCeiling,
): Issue[] {
  const issues: Issue[] = [];
  if (weeks.length === 0) {
    issues.push({ severity: 'error', message: 'Planen innehåller inga veckor.' });
    return issues;
  }

  const sorted = [...weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));

  const expectedFirstMonday = startOfWeek(goal.startDate);
  if (sorted[0].weekStart !== expectedFirstMonday) {
    issues.push({
      severity: 'error',
      message: `Första veckan ska börja måndagen ${expectedFirstMonday} (veckan som innehåller startdatumet ${goal.startDate}), inte ${sorted[0].weekStart}.`,
    });
  }

  // Half an hour of slack, because the plan is expressed in half-hour steps and
  // rounding up to one should not be treated as overreaching.
  if (ceiling && sorted[0].totalHours > ceiling.firstWeekHours + 0.5) {
    issues.push({
      severity: 'error',
      message: `Första veckan ligger på ${sorted[0].totalHours} h, men får vara högst ${ceiling.firstWeekHours} h. ${ceiling.because}`,
    });
  }

  const raceMonday = startOfWeek(goal.raceDate);
  const lastWeek = sorted[sorted.length - 1];
  if (lastWeek.weekStart !== raceMonday) {
    issues.push({
      severity: 'error',
      message: `Sista veckan ska vara tävlingsveckan som börjar ${raceMonday}, inte ${lastWeek.weekStart}.`,
    });
  }

  // Weeks must be consecutive Mondays with no gaps or duplicates.
  for (let i = 1; i < sorted.length; i += 1) {
    const expected = addDays(sorted[i - 1].weekStart, 7);
    if (sorted[i].weekStart !== expected) {
      issues.push({
        severity: 'error',
        message: `Veckorna hänger inte ihop: efter ${sorted[i - 1].weekStart} förväntas ${expected} men planen har ${sorted[i].weekStart}.`,
      });
      break;
    }
  }

  const budget = profile.weeklyHours * MAX_BUDGET_OVERSHOOT;
  const peak = sorted.reduce((best, w) => (w.totalHours > best.totalHours ? w : best), sorted[0]);

  sorted.forEach((week, index) => {
    if (week.totalHours <= 0) {
      issues.push({
        severity: 'error',
        message: `Veckan ${formatWeekRange(week.weekStart)} har 0 timmar.`,
      });
    }

    if (week.totalHours > budget) {
      issues.push({
        severity: 'error',
        message: `Veckan ${formatWeekRange(week.weekStart)} har ${week.totalHours} h, vilket överstiger den tillgängliga tiden på ${profile.weeklyHours} h per vecka.`,
      });
    }

    const sportSum = Object.values(week.sportHours).reduce((a, b) => a + b, 0);
    // A little slack for rounding in the model's own numbers.
    if (Math.abs(sportSum - week.totalHours) > 1.5) {
      issues.push({
        severity: 'error',
        message: `Veckan ${formatWeekRange(week.weekStart)}: summan av timmarna per sport (${sportSum.toFixed(1)} h) stämmer inte med veckans total (${week.totalHours} h).`,
      });
    }

    if (index > 0) {
      const previous = sorted[index - 1];
      // After a recovery week the volume is allowed to pick the trend back up,
      // so measure the ramp against the last week that was not a dip.
      const reference =
        previous.isRecoveryWeek && index >= 2 ? sorted[index - 2] : previous;
      // Plans are expressed in half hours, so on a small week a single step is
      // a large percentage without being a real jump in load. Allow whichever
      // is greater: the percentage rule or one half-hour step.
      const allowed = Math.max(
        reference.totalHours * MAX_WEEKLY_RAMP,
        reference.totalHours + MIN_RAMP_ALLOWANCE_HOURS,
      );
      if (week.totalHours > allowed && week.phase !== 'race') {
        const ratio = week.totalHours / reference.totalHours;
        issues.push({
          severity: 'error',
          message: `Veckan ${formatWeekRange(week.weekStart)} ökar volymen med ${Math.round((ratio - 1) * 100)} % mot ${formatWeekRange(reference.weekStart)}. Max ${MAX_WEEKLY_RAMP_PERCENT} % tillåts.`,
        });
      }
    }
  });

  // A recovery week has to show up regularly, and actually be lighter.
  let sinceRecovery = 0;
  for (const week of sorted) {
    if (week.phase === 'taper' || week.phase === 'race') break;
    if (week.isRecoveryWeek) sinceRecovery = 0;
    else sinceRecovery += 1;
    if (sinceRecovery > MAX_WEEKS_WITHOUT_RECOVERY) {
      issues.push({
        severity: 'error',
        message: `Det går ${sinceRecovery} veckor i rad utan återhämtningsvecka fram till ${formatWeekRange(week.weekStart)}. Lägg in en lättare vecka minst var fjärde vecka.`,
      });
      sinceRecovery = 0;
    }
  }

  sorted.forEach((week, index) => {
    if (!week.isRecoveryWeek || index === 0) return;
    if (week.totalHours >= sorted[index - 1].totalHours) {
      issues.push({
        severity: 'error',
        message: `Veckan ${formatWeekRange(week.weekStart)} är markerad som återhämtningsvecka men har inte lägre volym än veckan innan.`,
      });
    }
  });

  // The taper: volume must come down into the race.
  const taperWeeks = sorted.filter((w) => w.phase === 'taper' || w.phase === 'race');
  if (taperWeeks.length < 2 && sorted.length > 6) {
    issues.push({
      severity: 'error',
      message: 'Planen saknar nedtrappning. De sista två till tre veckorna före tävling ska ha fallande volym.',
    });
  }

  if (lastWeek.totalHours > peak.totalHours * MAX_RACE_WEEK_SHARE) {
    issues.push({
      severity: 'error',
      message: `Tävlingsveckan har ${lastWeek.totalHours} h, vilket är för mycket jämfört med toppveckans ${peak.totalHours} h. Tävlingsveckan bör ligga under ${Math.round(peak.totalHours * MAX_RACE_WEEK_SHARE)} h.`,
    });
  }

  for (let i = 1; i < taperWeeks.length; i += 1) {
    if (taperWeeks[i].totalHours > taperWeeks[i - 1].totalHours) {
      issues.push({
        severity: 'error',
        message: `Nedtrappningen går uppåt igen: ${formatWeekRange(taperWeeks[i].weekStart)} har mer volym än veckan innan.`,
      });
      break;
    }
  }

  if (peak.totalHours < profile.weeklyHours * 0.5) {
    issues.push({
      severity: 'warning',
      message: `Toppveckan ligger på ${peak.totalHours} h medan du angett att du har ${profile.weeklyHours} h tillgängligt. Planen kan vara i underkant.`,
    });
  }

  return issues;
}

export function validateSessions(
  sessions: Session[],
  logs: Record<string, SessionLog>,
  profile: AthleteProfile,
  goal: Goal,
  weeks: WeekPlan[],
  today = todayIso(),
): Issue[] {
  const issues: Issue[] = [];
  if (sessions.length === 0) return issues;

  for (const session of sessions) {
    if (session.date > goal.raceDate) {
      issues.push({
        severity: 'error',
        message: `Passet "${session.title}" ligger ${session.date}, efter tävlingsdatumet ${goal.raceDate}.`,
      });
    }
    if (session.durationMin <= 0 && session.sport !== 'rest') {
      issues.push({
        severity: 'error',
        message: `Passet "${session.title}" den ${session.date} har ingen längd.`,
      });
    }
    if (
      session.sport !== 'rest' &&
      session.intensity !== 'race' &&
      !profile.availableDays.includes(isoWeekday(session.date))
    ) {
      issues.push({
        severity: 'warning',
        message: `Passet "${session.title}" ligger ${session.date}, en dag du angett att du inte kan träna.`,
      });
    }
  }

  const weekStarts = [...new Set(sessions.map((s) => startOfWeek(s.date)))].sort();
  for (const weekStart of weekStarts) {
    const stats = weekStats(sessions, logs, weekStart);
    if (stats.sessionCount === 0) continue;

    if (stats.restDayCount === 0) {
      issues.push({
        severity: 'error',
        message: `Veckan ${formatWeekRange(weekStart)} saknar vilodag. Minst en dag i veckan ska vara helt fri.`,
      });
    }

    if (stats.hardSessionCount > 3) {
      issues.push({
        severity: 'error',
        message: `Veckan ${formatWeekRange(weekStart)} har ${stats.hardSessionCount} hårda pass (${HARD_INTENSITIES.join(', ')}). Max tre per vecka.`,
      });
    }

    const outline = weeks.find((w) => w.weekStart === weekStart);
    if (outline) {
      // The race itself is not training volume, so it is left out when checking
      // the week against the hours the outline budgeted.
      const raceMinutes = sessions
        .filter((s) => startOfWeek(s.date) === weekStart && s.intensity === 'race')
        .reduce((sum, s) => sum + s.durationMin, 0);
      const plannedHours = (stats.plannedMin - raceMinutes) / 60;
      // A week already under way can only hold the days that are left.
      const expected = expectedWeekHours(outline, profile, today);
      const drift = Math.abs(plannedHours - expected);
      if (drift > Math.max(1.5, expected * 0.2)) {
        issues.push({
          severity: 'warning',
          message: `Veckan ${formatWeekRange(weekStart)} har ${plannedHours.toFixed(1)} h utlagt men veckoplanen säger ${expected} h.`,
        });
      }
    }
  }

  return issues;
}

export function errorsOnly(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === 'error');
}

export function issuesToPrompt(issues: Issue[]): string {
  return errorsOnly(issues)
    .map((i, index) => `${index + 1}. ${i.message}`)
    .join('\n');
}

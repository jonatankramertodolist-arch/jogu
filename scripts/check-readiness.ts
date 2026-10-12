/**
 * Checks the judgement that decides how hard the next block gets.
 *
 * This is the safety net in the whole app: if it reads a worn-out athlete as
 * ready to push, the plan keeps climbing until something gives. So each scenario
 * below is a situation a real athlete ends up in, with the verdict it must reach.
 * Run with `npm run check`.
 */

import { addDays, startOfWeek, todayIso } from '../src/lib/dates';
import { buildOutline } from '../src/lib/plan-builder';
import { assessReadiness, suggestNextBlock, volumeBaseline } from '../src/lib/readiness';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from '../src/lib/store';
import { MAX_WEEKLY_RAMP, validateWeeks } from '../src/lib/validation';
import type { ReadinessVerdict } from '../src/lib/readiness';
import type { AppState, Feeling, Goal, Session, SessionLog } from '../src/lib/types';

let failures = 0;

function ok(label: string, detail = ''): void {
  console.log(`  OK   ${label}${detail ? `  (${detail})` : ''}`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  console.log(`  FAIL ${label}`);
  console.log(`         - ${detail}`);
}

function expectVerdict(label: string, actual: ReadinessVerdict, expected: ReadinessVerdict, reasons: string[]): void {
  if (actual === expected) ok(label, `${actual}: ${reasons[0] ?? 'inga skäl'}`);
  else fail(label, `Fick "${actual}" men väntade "${expected}". Skäl: ${reasons.join(' ') || 'inga'}`);
}

interface Pattern {
  /** Days back from today the logged history covers. */
  days: number;
  /** Sessions per week; the rest of the days are left free. */
  daysPerWeek: number;
  minutes: number;
  rpe: number | null;
  feeling: Feeling | null;
  /** Share of the planned sessions that were actually done, 0 to 1. */
  completion: number;
}

/**
 * Builds a history that looks like somebody's last few weeks. Sessions are laid
 * out backwards from today so the streak and rolling-window maths sees what a
 * real logbook would.
 */
function history(pattern: Pattern): { sessions: Session[]; logs: Record<string, SessionLog> } {
  const sessions: Session[] = [];
  const logs: Record<string, SessionLog> = {};
  const today = todayIso();
  let placed = 0;

  for (let back = 0; back < pattern.days; back += 1) {
    const date = addDays(today, -back);
    // Which days of a seven-day cycle carry a session.
    if (back % 7 >= pattern.daysPerWeek) continue;

    const id = `s-${back}`;
    // Spread the skipped sessions evenly rather than in one block, so the
    // fourteen-day completion window sees the same share as the whole period.
    const done = placed % 10 < Math.round(pattern.completion * 10);
    placed += 1;

    sessions.push({
      id,
      date,
      sport: 'bike',
      title: 'Pass',
      intensity: 'endurance',
      durationMin: pattern.minutes,
      distanceKm: null,
      description: '',
      status: done ? 'done' : 'planned',
      order: 0,
      source: 'ai',
    });

    if (done) {
      logs[id] = {
        sessionId: id,
        loggedAt: `${date}T18:00:00.000Z`,
        actualDurationMin: pattern.minutes,
        actualDistanceKm: null,
        rpe: pattern.rpe,
        feeling: pattern.feeling,
        sleepHours: null,
        soreness: null,
        note: '',
      };
    }
  }

  return { sessions, logs };
}

function athlete(
  pattern: Pattern,
  overrides: { weeklyHours?: number; ambition?: number } = {},
): AppState {
  const { sessions, logs } = history(pattern);
  return {
    schemaVersion: 1,
    profile: { ...DEFAULT_PROFILE, weeklyHours: overrides.weeklyHours ?? 10 },
    goal: null,
    plan: null,
    sessions,
    logs,
    adjustments: [],
    chat: [],
    settings: { ...DEFAULT_SETTINGS, ambition: overrides.ambition ?? 50 },
    isDemo: false,
  };
}

console.log('Omdöme om nästa block');

// Somebody training every single day, finding it heavy, and finishing it all.
// Completing everything is the one positive signal here, and it must not be
// enough to outweigh the exhaustion.
{
  const state = athlete({
    days: 28,
    daysPerWeek: 7,
    minutes: 75,
    rpe: 8.5,
    feeling: 'exhausted',
    completion: 1,
  });
  const readiness = assessReadiness(state);
  expectVerdict('sliten atlet som ändå gör allt', readiness.verdict, 'recover', readiness.reasons);
  if (readiness.volumeFactor >= 1) {
    fail('sliten atlet: volymen ska ner', `volumeFactor blev ${readiness.volumeFactor}`);
  } else {
    ok('sliten atlet: volymen ska ner', `${readiness.volumePercent} %`);
  }
  if (readiness.maxHardSessions !== 0) {
    fail('sliten atlet: inga hårda pass', `tillät ${readiness.maxHardSessions}`);
  } else ok('sliten atlet: inga hårda pass');
}

// Training well within herself, finishing everything, with days off.
{
  const state = athlete({
    days: 28,
    daysPerWeek: 5,
    minutes: 60,
    rpe: 4,
    feeling: 'strong',
    completion: 1,
  });
  const readiness = assessReadiness(state);
  expectVerdict('pigg atlet med marginal', readiness.verdict, 'push', readiness.reasons);
  if (readiness.volumeFactor <= 1) fail('pigg atlet: volymen ska upp', `blev ${readiness.volumeFactor}`);
  else ok('pigg atlet: volymen ska upp', `+${readiness.volumePercent} %`);
}

// A schedule that is simply too big. Nothing hurts, most of it just never happens.
{
  const state = athlete({
    days: 28,
    daysPerWeek: 6,
    minutes: 70,
    rpe: 6,
    feeling: 'ok',
    completion: 0.45,
  });
  const readiness = assessReadiness(state);
  if (readiness.verdict === 'push') {
    fail('halvt genomfört schema', 'föreslog att pressa på trots att hälften av passen aldrig blev av');
  } else ok(`halvt genomfört schema`, `${readiness.verdict}: ${readiness.reasons[0]}`);
}

// Nothing logged at all. Guessing here is what the whole module exists to avoid.
{
  const state = athlete({ days: 0, daysPerWeek: 0, minutes: 0, rpe: null, feeling: null, completion: 0 });
  const readiness = assessReadiness(state);
  expectVerdict('inga loggade pass', readiness.verdict, 'hold', readiness.reasons);
  if (!readiness.uncertain) fail('inga loggade pass: ska flaggas osäkert', 'uncertain var false');
  else ok('inga loggade pass: flaggas osäkert');
  if (readiness.volumeFactor !== 1) fail('inga loggade pass: oförändrad volym', `blev ${readiness.volumeFactor}`);
  else ok('inga loggade pass: oförändrad volym');
}

console.log('\nAmbitionsreglaget');
{
  const pattern: Pattern = {
    days: 28,
    daysPerWeek: 5,
    minutes: 60,
    rpe: 4,
    feeling: 'strong',
    completion: 1,
  };
  const cautious = assessReadiness(athlete(pattern, { ambition: 0 }));
  const bold = assessReadiness(athlete(pattern, { ambition: 100 }));

  if (bold.volumeFactor > cautious.volumeFactor) {
    ok('högre ambition ger större steg', `${cautious.volumePercent} % mot ${bold.volumePercent} %`);
  } else {
    fail('högre ambition ger större steg', `${cautious.volumeFactor} mot ${bold.volumeFactor}`);
  }

  // The slider moves the dial inside the safety rules; it does not remove them.
  if (bold.volumeFactor > MAX_WEEKLY_RAMP + 0.0001) {
    fail('reglaget går inte över säkerhetstaket', `${bold.volumeFactor} > ${MAX_WEEKLY_RAMP}`);
  } else ok('reglaget går inte över säkerhetstaket', `max ${bold.volumePercent} %`);

  // And it must never turn a warning into more training.
  const tired: Pattern = {
    days: 28,
    daysPerWeek: 7,
    minutes: 75,
    rpe: 8.5,
    feeling: 'exhausted',
    completion: 1,
  };
  const boldButTired = assessReadiness(athlete(tired, { ambition: 100 }));
  if (boldButTired.volumeFactor >= 1) {
    fail('full ambition kan inte köra över utmattning', `volumeFactor ${boldButTired.volumeFactor}`);
  } else {
    ok('full ambition kan inte köra över utmattning', `${boldButTired.volumePercent} %`);
  }
}

console.log('\nVolymen bygger på genomförd träning');
{
  // Planned ten hours a week, managed about half. The next block must build on
  // what happened, not on what was written down.
  const state = athlete(
    { days: 28, daysPerWeek: 6, minutes: 60, rpe: 6, feeling: 'ok', completion: 0.5 },
    { weeklyHours: 10 },
  );
  const baseline = volumeBaseline(state.sessions, state.logs);
  if (baseline.completedHoursPerWeek >= baseline.plannedHoursPerWeek) {
    fail(
      'utgår från genomförda timmar',
      `genomfört ${baseline.completedHoursPerWeek} h mot planerat ${baseline.plannedHoursPerWeek} h`,
    );
  } else {
    ok(
      'utgår från genomförda timmar',
      `genomfört ${baseline.completedHoursPerWeek} h, planerat ${baseline.plannedHoursPerWeek} h`,
    );
  }

  const suggestion = suggestNextBlock(state);
  if (suggestion.suggestedHours > state.profile.weeklyHours) {
    fail('förslaget håller sig inom atletens gräns', `${suggestion.suggestedHours} h > ${state.profile.weeklyHours} h`);
  } else ok('förslaget håller sig inom atletens gräns', `${suggestion.suggestedHours} h`);

  if (!suggestion.explanation.includes(String(baseline.completedHoursPerWeek))) {
    fail('förklaringen nämner den genomförda volymen', suggestion.explanation);
  } else ok('förklaringen nämner den genomförda volymen');
}

console.log('\nTaket stoppar en för stor plan');
{
  // Calculating a sensible ceiling is worth nothing if a plan above it still gets
  // through, so this checks the enforcement rather than the arithmetic.
  const start = startOfWeek(todayIso());
  const profile = { ...DEFAULT_PROFILE, weeklyHours: 12 };
  const goal: Goal = {
    raceName: 'Taktest',
    raceType: 'ironman',
    startDate: start,
    raceDate: addDays(start, 16 * 7 - 1),
    goalTime: '',
    notes: '',
  };
  const ceiling = { firstWeekHours: 5, because: 'Du har genomfört 5 h i veckan.' };

  const tooBig = buildOutline(goal, profile, { startHours: 11 });
  const rejected = validateWeeks(tooBig, profile, goal, ceiling).filter((i) => i.severity === 'error');
  if (rejected.length === 0) {
    fail('plan över taket underkänns', `första veckan ${tooBig[0].totalHours} h slank igenom taket ${ceiling.firstWeekHours} h`);
  } else ok('plan över taket underkänns', rejected[0].message);

  const withinCeiling = buildOutline(goal, profile, { startHours: ceiling.firstWeekHours });
  const accepted = validateWeeks(withinCeiling, profile, goal, ceiling).filter((i) => i.severity === 'error');
  if (accepted.length > 0) {
    fail('plan som utgår från taket godkänns', accepted.map((i) => i.message).join(' '));
  } else ok('plan som utgår från taket godkänns', `börjar på ${withinCeiling[0].totalHours} h`);
}

console.log(failures === 0 ? '\nAlla kontroller gick igenom.' : `\n${failures} fel hittades.`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Sanity check for the deterministic plan builder: the demo plan and a range of
 * athlete profiles must all satisfy the same training rules the AI output is
 * held to. Run with `npm run check`.
 */

import { normaliseWeeks } from '../src/lib/ai/coach';
import { buildDemoPlan, buildOutline, buildWeekSessions } from '../src/lib/plan-builder';
import { validateSessions, validateWeeks } from '../src/lib/validation';
import { addDays, startOfWeek, todayIso } from '../src/lib/dates';
import { RACE_TYPE_IS_TRIATHLON } from '../src/lib/types';
import type { AthleteProfile, Goal, RaceType } from '../src/lib/types';

let failures = 0;

function report(label: string, issues: { severity: string; message: string }[]): void {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (errors.length === 0) {
    console.log(`  OK   ${label}${warnings.length ? ` (${warnings.length} varningar)` : ''}`);
    for (const warning of warnings.slice(0, 2)) console.log(`         ~ ${warning.message}`);
    return;
  }
  failures += errors.length;
  console.log(`  FAIL ${label}`);
  for (const error of errors) console.log(`         - ${error.message}`);
}

console.log('Demoplan');
const demo = buildDemoPlan();
report('veckoplan', validateWeeks(demo.weeks, demo.profile, demo.goal));
report(
  'pass',
  validateSessions(demo.sessions, {}, demo.profile, demo.goal, demo.weeks),
);

const baseProfile: AthleteProfile = {
  name: '',
  birthYear: 1990,
  weightKg: 75,
  weeklyHours: 10,
  availableDays: [1, 2, 3, 4, 5, 6, 7],
  longSessionDays: [6, 7],
  experience: 'intermediate',
  swimBackground: '',
  bikeBackground: '',
  runBackground: '',
  injuries: '',
  notes: '',
};

const scenarios: { label: string; weeks: number; raceType: RaceType; profile: AthleteProfile }[] = [
  { label: 'Ironman, 24 veckor, 12 h', weeks: 24, raceType: 'ironman', profile: { ...baseProfile, weeklyHours: 12 } },
  { label: 'Ironman, 40 veckor, 16 h', weeks: 40, raceType: 'ironman', profile: { ...baseProfile, weeklyHours: 16 } },
  { label: '70.3, 16 veckor, 8 h', weeks: 16, raceType: 'half-ironman', profile: { ...baseProfile, weeklyHours: 8 } },
  { label: 'Marathon, 18 veckor, 6 h', weeks: 18, raceType: 'marathon', profile: { ...baseProfile, weeklyHours: 6 } },
  { label: 'Sprint, 8 veckor, 5 h', weeks: 8, raceType: 'sprint', profile: { ...baseProfile, weeklyHours: 5 } },
  { label: 'Olympisk, 3 veckor, 7 h', weeks: 3, raceType: 'olympic', profile: { ...baseProfile, weeklyHours: 7 } },
  {
    label: 'Ironman, 24 veckor, bara 4 träningsdagar',
    weeks: 24,
    raceType: 'ironman',
    profile: { ...baseProfile, weeklyHours: 9, availableDays: [2, 4, 6, 7], longSessionDays: [6, 7] },
  },
  {
    label: 'Marathon, 12 veckor, långpass på onsdag',
    weeks: 12,
    raceType: 'marathon',
    profile: { ...baseProfile, weeklyHours: 7, availableDays: [1, 3, 5, 6], longSessionDays: [3] },
  },
  {
    label: 'Ironman, 24 veckor, bara onsdag och söndag',
    weeks: 24,
    raceType: 'ironman',
    profile: { ...baseProfile, weeklyHours: 12, availableDays: [3, 7], longSessionDays: [7] },
  },
];

console.log('\nScenarier');
for (const scenario of scenarios) {
  const start = startOfWeek(todayIso());
  const goal: Goal = {
    raceName: scenario.label,
    raceType: scenario.raceType,
    startDate: start,
    raceDate: addDays(start, scenario.weeks * 7 - 1),
    goalTime: '',
    notes: '',
  };

  const weeks = buildOutline(goal, scenario.profile);
  report(`${scenario.label}: veckoplan (${weeks.length} veckor)`, validateWeeks(weeks, scenario.profile, goal));

  const sessions = weeks.flatMap((week) => buildWeekSessions(week, goal, scenario.profile));
  report(
    `${scenario.label}: pass (${sessions.length} st)`,
    validateSessions(sessions, {}, scenario.profile, goal, weeks),
  );

  // Running straight off the bike is a key triathlon session, so the plan must
  // actually put the two on the same day rather than one session per day.
  if (RACE_TYPE_IS_TRIATHLON[scenario.raceType]) {
    const byDate = new Map<string, Set<string>>();
    for (const session of sessions) {
      if (!byDate.has(session.date)) byDate.set(session.date, new Set());
      byDate.get(session.date)!.add(session.sport);
    }
    const bricks = [...byDate.values()].filter((s) => s.has('bike') && s.has('run')).length;
    // Below roughly an hour and a half of running a week, two proper runs beat
    // three short ones, so a plan that never gets there is not expected to.
    const peakRunMinutes = Math.max(...weeks.map((w) => w.sportHours.run * 60));
    report(
      `${scenario.label}: brickpass (${bricks} st)`,
      bricks > 0 || peakRunMinutes < 90
        ? []
        : [{ severity: 'error', message: 'Planen innehåller inget pass där löpning följer direkt på cykel.' }],
    );
  }
}

/**
 * A model response that is empty or cut short must never be turned into a plan
 * of near-empty weeks. This once produced schedules of half an hour a week.
 */
console.log('\nReservplan när modellen svarar dåligt');
{
  const profile: AthleteProfile = { ...baseProfile, weeklyHours: 12 };
  const start = startOfWeek(todayIso());
  const goal: Goal = {
    raceName: 'Reservplan',
    raceType: 'ironman',
    startDate: start,
    raceDate: addDays(start, 24 * 7 - 1),
    goalTime: '',
    notes: '',
  };
  const standard = buildOutline(goal, profile);
  const mondays = standard.map((w) => w.weekStart);

  const check = (label: string, weeks: typeof standard): void => {
    const thin = weeks.filter((w) => w.phase !== 'race' && w.totalHours < profile.weeklyHours * 0.3);
    if (thin.length > 0) {
      failures += 1;
      console.log(`  FAIL ${label}`);
      console.log(`         - ${thin.length} veckor under ${profile.weeklyHours * 0.3} h, t.ex. ${thin[0].weekStart} med ${thin[0].totalHours} h`);
      return;
    }
    report(label, validateWeeks(weeks, profile, goal));
  };

  check('tomt svar', normaliseWeeks([], mondays, standard));
  check(
    'avhugget svar efter 3 veckor',
    normaliseWeeks(
      standard.slice(0, 3).map((w) => ({
        weekStart: w.weekStart,
        phase: w.phase,
        focus: w.focus,
        totalHours: w.totalHours,
        swimHours: w.sportHours.swim,
        bikeHours: w.sportHours.bike,
        runHours: w.sportHours.run,
        strengthHours: w.sportHours.strength,
      })),
      mondays,
      standard,
    ),
  );
}

console.log(failures === 0 ? '\nAlla kontroller gick igenom.' : `\n${failures} fel hittades.`);
process.exit(failures === 0 ? 0 : 1);

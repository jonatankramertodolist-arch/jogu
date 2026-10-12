import { addDays, startOfWeek, todayIso } from '../dates';
import { applyOperations } from '../patch';
import { buildOutline, weekCount } from '../plan-builder';
import { newId } from '../store';
import type { NextBlockSuggestion } from '../readiness';
import {
  errorsOnly,
  issuesToPrompt,
  validateSessions,
  validateWeeks,
  type Issue,
  type PlanCeiling,
} from '../validation';
import {
  type Adjustment,
  type AppState,
  type AthleteProfile,
  type Goal,
  type Intensity,
  type PhaseName,
  type Session,
  type SessionOperation,
  type Sport,
  type WeekOperation,
  type WeekPlan,
} from '../types';
import { AiError, callWithSchema, type Message } from './client';
import { coachReplySchema, outlineSchema, sessionsSchema } from './schemas';
import {
  athleteContext,
  coachSystemPrompt,
  outlineUserPrompt,
  sessionsUserPrompt,
} from './prompts';

/**
 * The model proposes, the rules in `validation.ts` decide. When a proposal
 * breaks a training rule it is handed back with the specific complaint, which
 * fixes most problems on the second attempt.
 */

const MAX_ATTEMPTS = 3;
/** Weeks per detailing call, to keep responses well inside the token limit. */
const DETAIL_CHUNK_WEEKS = 4;

const VALID_PHASES: PhaseName[] = ['base', 'build', 'peak', 'taper', 'race'];
const VALID_SPORTS: Sport[] = ['swim', 'bike', 'run', 'strength', 'multi', 'rest'];
const VALID_INTENSITIES: Intensity[] = [
  'recovery',
  'easy',
  'endurance',
  'tempo',
  'threshold',
  'vo2',
  'race',
];

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function blankToNull(value: unknown): string | null {
  const text = str(value);
  return text === '' ? null : text;
}

interface RawWeek {
  weekStart?: unknown;
  phase?: unknown;
  focus?: unknown;
  totalHours?: unknown;
  swimHours?: unknown;
  bikeHours?: unknown;
  runHours?: unknown;
  strengthHours?: unknown;
  keySessions?: unknown;
  isRecoveryWeek?: unknown;
}

/**
 * Week starts are forced onto the expected Mondays. Letting the model's own
 * dates through was the single biggest source of broken plans, and the order it
 * returns weeks in has always been right.
 *
 * Weeks the model left out or returned empty are taken from the deterministic
 * outline. A truncated response must never silently turn into near-empty weeks,
 * which is what produced schedules of half an hour a week.
 */
export function normaliseWeeks(
  raw: RawWeek[],
  mondays: string[],
  fallback: WeekPlan[],
): WeekPlan[] {
  return mondays.map((weekStart, index) => {
    const week = raw[index];
    const standard = fallback[index];

    const sportHours = {
      swim: Math.max(0, num(week?.swimHours)),
      bike: Math.max(0, num(week?.bikeHours)),
      run: Math.max(0, num(week?.runHours)),
      strength: Math.max(0, num(week?.strengthHours)),
    };
    const sportSum = sportHours.swim + sportHours.bike + sportHours.run + sportHours.strength;
    const totalHours = num(week?.totalHours, sportSum) || sportSum;

    if (!week || totalHours <= 0) {
      return { ...standard, weekStart, weekNumber: index + 1, detailed: false };
    }

    const phase = VALID_PHASES.includes(week.phase as PhaseName)
      ? (week.phase as PhaseName)
      : standard.phase;

    return {
      weekStart,
      weekNumber: index + 1,
      phase,
      focus: str(week.focus) || standard.focus,
      totalHours: Math.round(totalHours * 2) / 2,
      // A total without a breakdown is still usable; borrow the standard split
      // rather than telling the session writer every discipline is zero hours.
      sportHours: sportSum > 0 ? sportHours : scaleSportHours(standard, totalHours),
      keySessions: Array.isArray(week.keySessions)
        ? week.keySessions.map(str).filter(Boolean).slice(0, 4)
        : [],
      isRecoveryWeek: week.isRecoveryWeek === true,
      detailed: false,
    };
  });
}

/** The standard week's discipline split, resized to the given total. */
function scaleSportHours(standard: WeekPlan, totalHours: number): WeekPlan['sportHours'] {
  const sum = Object.values(standard.sportHours).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...standard.sportHours };
  const factor = totalHours / sum;
  return {
    swim: Math.round(standard.sportHours.swim * factor * 2) / 2,
    bike: Math.round(standard.sportHours.bike * factor * 2) / 2,
    run: Math.round(standard.sportHours.run * factor * 2) / 2,
    strength: Math.round(standard.sportHours.strength * factor * 2) / 2,
  };
}

export interface OutlineResult {
  summary: string;
  weeks: WeekPlan[];
  issues: Issue[];
  attempts: number;
}

export async function generateOutline(args: {
  model: string;
  goal: Goal;
  profile: AthleteProfile;
  tone: AppState['settings']['coachTone'];
  /**
   * What the athlete's logged training says about how much they can take. Absent
   * for a first plan, when there is nothing to go on yet.
   */
  suggestion?: NextBlockSuggestion;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<OutlineResult> {
  const total = weekCount(args.goal);
  if (total < 2) {
    throw new AiError(
      'Tiden mellan startdatum och tävlingsdatum är för kort för att bygga en plan. Välj ett tävlingsdatum minst två veckor fram.',
      'request',
    );
  }

  const firstMonday = startOfWeek(args.goal.startDate);
  const mondays = Array.from({ length: total }, (_, i) => addDays(firstMonday, i * 7));

  // Built up front so any week the model leaves out has something sound to fall
  // back on, and so there is a known-good plan if the model never gets it right.
  // It starts where the readiness verdict says it should, otherwise the fallback
  // would breach the very ceiling the model is held to.
  const standard = buildOutline(args.goal, args.profile, {
    startHours: args.suggestion?.suggestedHours,
  });

  const ceiling: PlanCeiling | undefined = args.suggestion
    ? {
        firstWeekHours: args.suggestion.suggestedHours,
        because: args.suggestion.explanation,
      }
    : undefined;

  const system = coachSystemPrompt(args.tone);
  const messages: Message[] = [
    {
      role: 'user',
      content: outlineUserPrompt(args.goal, args.profile, mondays, args.suggestion),
    },
  ];

  let lastIssues: Issue[] = [];
  let lastWeeks: WeekPlan[] | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    args.onProgress?.(
      attempt === 1
        ? 'Lägger upp veckoplanen...'
        : `Rättar till ${errorsOnly(lastIssues).length} problem i planen (försök ${attempt})...`,
    );

    const raw = await callWithSchema<{ summary?: unknown; weeks?: RawWeek[] }>({
      model: args.model,
      system,
      messages,
      maxTokens: 16_000,
      signal: args.signal,
      toolName: 'submit_outline',
      toolDescription: 'Lämna in den periodiserade veckoplanen.',
      schema: outlineSchema as unknown as Record<string, unknown>,
    });

    const weeks = normaliseWeeks(Array.isArray(raw.weeks) ? raw.weeks : [], mondays, standard);
    const issues = validateWeeks(weeks, args.profile, args.goal, ceiling);
    lastIssues = issues;
    lastWeeks = weeks;

    if (errorsOnly(issues).length === 0) {
      return { summary: str(raw.summary), weeks, issues, attempts: attempt };
    }

    messages.push(
      { role: 'assistant', content: JSON.stringify({ weeks: weeks.map((w) => ({ weekStart: w.weekStart, totalHours: w.totalHours })) }) },
      {
        role: 'user',
        content: `Planen bryter mot följande regler. Lämna in en rättad version av hela planen:\n\n${issuesToPrompt(issues)}`,
      },
    );
  }

  // Every attempt broke a rule. The deterministic outline always passes, so it
  // is used unless the model's last attempt somehow breaks fewer rules.
  const standardIssues = validateWeeks(standard, args.profile, args.goal, ceiling);
  if (lastWeeks == null || errorsOnly(standardIssues).length <= errorsOnly(lastIssues).length) {
    return {
      summary: '',
      weeks: standard,
      issues: [
        {
          severity: 'warning',
          message:
            'Coachens eget upplägg klarade inte träningsreglerna, så du fick ett standardupplägg byggt på din tid och distans. Be coachen justera det i chatten.',
        },
        ...standardIssues,
      ],
      attempts: MAX_ATTEMPTS,
    };
  }

  return { summary: '', weeks: lastWeeks, issues: lastIssues, attempts: MAX_ATTEMPTS };
}

interface RawSession {
  date?: unknown;
  sport?: unknown;
  title?: unknown;
  intensity?: unknown;
  durationMin?: unknown;
  distanceKm?: unknown;
  description?: unknown;
}

function normaliseSessions(raw: RawSession[], from: string, to: string): Session[] {
  const perDay: Record<string, number> = {};
  const out: Session[] = [];

  for (const item of raw) {
    const date = str(item.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) continue;

    const sport = VALID_SPORTS.includes(item.sport as Sport) ? (item.sport as Sport) : 'run';
    if (sport === 'rest') continue;

    const durationMin = Math.round(num(item.durationMin));
    if (durationMin < 10) continue;

    const order = perDay[date] ?? 0;
    perDay[date] = order + 1;

    const distance = num(item.distanceKm);

    out.push({
      id: newId(),
      date,
      sport,
      title: str(item.title) || 'Träningspass',
      intensity: VALID_INTENSITIES.includes(item.intensity as Intensity)
        ? (item.intensity as Intensity)
        : 'easy',
      durationMin,
      distanceKm: distance > 0 ? Math.round(distance * 10) / 10 : null,
      description: str(item.description),
      status: 'planned',
      order,
      source: 'ai',
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
}

export interface DetailResult {
  sessions: Session[];
  weekStarts: string[];
  issues: Issue[];
}

/** Fills in concrete sessions for the given outlined weeks. */
export async function detailWeeks(args: {
  model: string;
  state: AppState;
  weeks: WeekPlan[];
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<DetailResult> {
  const { state } = args;
  if (!state.goal) throw new AiError('Inget mål är satt.', 'request');

  const chunks: WeekPlan[][] = [];
  for (let i = 0; i < args.weeks.length; i += DETAIL_CHUNK_WEEKS) {
    chunks.push(args.weeks.slice(i, i + DETAIL_CHUNK_WEEKS));
  }

  const allSessions: Session[] = [];
  const allIssues: Issue[] = [];
  const context = athleteContext(state);

  for (const [index, chunk] of chunks.entries()) {
    args.onProgress?.(
      chunks.length > 1
        ? `Skriver ut pass, del ${index + 1} av ${chunks.length}...`
        : 'Skriver ut passen...',
    );

    const from = chunk[0].weekStart;
    const to = addDays(chunk[chunk.length - 1].weekStart, 6);

    const system = coachSystemPrompt(state.settings.coachTone);
    const messages: Message[] = [
      {
        role: 'user',
        content: sessionsUserPrompt(chunk, state.goal, state.profile, context),
      },
    ];

    let sessions: Session[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const raw = await callWithSchema<{ sessions?: RawSession[] }>({
        model: args.model,
        system,
        messages,
        maxTokens: 16_000,
        signal: args.signal,
        toolName: 'submit_sessions',
        toolDescription: 'Lämna in de konkreta passen för veckorna.',
        schema: sessionsSchema as unknown as Record<string, unknown>,
      });

      sessions = normaliseSessions(Array.isArray(raw.sessions) ? raw.sessions : [], from, to);
      const issues = validateSessions(sessions, state.logs, state.profile, state.goal, chunk);

      if (errorsOnly(issues).length === 0 || attempt === 2) {
        allIssues.push(...issues);
        break;
      }

      messages.push(
        { role: 'assistant', content: 'Passen lämnades in.' },
        {
          role: 'user',
          content: `Passen bryter mot följande regler. Lämna in en rättad version av samtliga pass för dessa veckor:\n\n${issuesToPrompt(issues)}`,
        },
      );
    }

    allSessions.push(...sessions);
  }

  return {
    sessions: allSessions,
    weekStarts: args.weeks.map((w) => w.weekStart),
    issues: allIssues,
  };
}

interface RawOp {
  op?: unknown;
  sessionId?: unknown;
  date?: unknown;
  sport?: unknown;
  title?: unknown;
  intensity?: unknown;
  durationMin?: unknown;
  distanceKm?: unknown;
  description?: unknown;
  why?: unknown;
}

function normaliseSessionOps(raw: RawOp[]): SessionOperation[] {
  const valid: SessionOperation['op'][] = ['add', 'update', 'remove', 'move'];
  return raw
    .filter((item) => valid.includes(item.op as SessionOperation['op']))
    .map((item) => {
      const durationMin = Math.round(num(item.durationMin));
      const distanceKm = num(item.distanceKm);
      const sport = str(item.sport);
      const intensity = str(item.intensity);
      return {
        op: item.op as SessionOperation['op'],
        sessionId: blankToNull(item.sessionId),
        date: blankToNull(item.date),
        sport: VALID_SPORTS.includes(sport as Sport) ? (sport as Sport) : null,
        title: blankToNull(item.title),
        intensity: VALID_INTENSITIES.includes(intensity as Intensity)
          ? (intensity as Intensity)
          : null,
        durationMin: durationMin > 0 ? durationMin : null,
        distanceKm: distanceKm > 0 ? Math.round(distanceKm * 10) / 10 : null,
        description: blankToNull(item.description),
        why: str(item.why),
      };
    });
}

function normaliseWeekOps(raw: RawOp[] & { weekStart?: unknown }[]): WeekOperation[] {
  return (raw as { weekStart?: unknown; totalHours?: unknown; focus?: unknown; isRecoveryWeek?: unknown; why?: unknown }[])
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(str(item.weekStart)))
    .map((item) => {
      const totalHours = num(item.totalHours);
      return {
        weekStart: str(item.weekStart),
        totalHours: totalHours > 0 ? Math.round(totalHours * 2) / 2 : null,
        focus: blankToNull(item.focus),
        isRecoveryWeek: typeof item.isRecoveryWeek === 'boolean' ? item.isRecoveryWeek : null,
        why: str(item.why),
      };
    });
}

export interface CoachTurnResult {
  message: string;
  adjustment: Adjustment | null;
  /** Warnings that were accepted but are worth showing the athlete. */
  issues: Issue[];
}

/**
 * One turn of coaching: answers the athlete and, when warranted, proposes
 * changes. Proposals are dry-run against the rules before being offered.
 */
export async function coachTurn(args: {
  model: string;
  state: AppState;
  userMessage: string;
  trigger: Adjustment['trigger'];
  history: Message[];
  signal?: AbortSignal;
}): Promise<CoachTurnResult> {
  const { state } = args;
  if (!state.goal || !state.plan) throw new AiError('Ingen plan att justera.', 'request');

  const system = `${coachSystemPrompt(state.settings.coachTone)}

Du får atletens nuläge i varje meddelande. När du vill ändra planen gör du det genom ändringsoperationer, aldrig genom att skriva om planen i text. Ändra bara pass som ligger i framtiden. Överreagera inte på ett enstaka dåligt pass: en tung dag är normalt, det är mönster över flera pass som ska leda till ändringar. Föreslå inga ändringar alls om planen ser rimlig ut, utan svara då bara på frågan.`;

  const messages: Message[] = [
    ...args.history,
    {
      role: 'user',
      content: `NULÄGE\n${athleteContext(state)}\n\nATLETEN SKRIVER\n${args.userMessage}`,
    },
  ];

  let lastResult: CoachTurnResult | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const raw = await callWithSchema<{
      message?: unknown;
      reasoning?: unknown;
      sessionOps?: RawOp[];
      weekOps?: RawOp[];
    }>({
      model: args.model,
      system,
      messages,
      maxTokens: 4_000,
      signal: args.signal,
      toolName: 'coach_reply',
      toolDescription: 'Svara atleten och föreslå eventuella ändringar i planen.',
      schema: coachReplySchema as unknown as Record<string, unknown>,
    });

    const message = str(raw.message) || 'Jag hann inte formulera något svar.';
    const sessionOps = normaliseSessionOps(Array.isArray(raw.sessionOps) ? raw.sessionOps : []);
    const weekOps = normaliseWeekOps(Array.isArray(raw.weekOps) ? (raw.weekOps as never) : []);

    if (sessionOps.length === 0 && weekOps.length === 0) {
      return { message, adjustment: null, issues: [] };
    }

    // Dry run: apply to copies and check the result against the rules before
    // ever showing it to the athlete.
    const preview = applyOperations(state.sessions, state.plan.weeks, sessionOps, weekOps);
    const weekIssues = validateWeeks(preview.weeks, state.profile, state.goal);
    const sessionIssues = validateSessions(
      preview.sessions,
      state.logs,
      state.profile,
      state.goal,
      preview.weeks,
    );
    const issues = [...weekIssues, ...sessionIssues];

    const adjustment: Adjustment = {
      id: newId(),
      at: new Date().toISOString(),
      trigger: args.trigger,
      reasoning: str(raw.reasoning),
      message,
      sessionOps,
      weekOps,
      status: 'pending',
      undo: null,
    };

    lastResult = { message, adjustment, issues };

    if (errorsOnly(issues).length === 0 || attempt === 2) return lastResult;

    messages.push(
      { role: 'assistant', content: message },
      {
        role: 'user',
        content: `Dina föreslagna ändringar bryter mot följande regler. Föreslå en justerad version:\n\n${issuesToPrompt(issues)}`,
      },
    );
  }

  return lastResult!;
}

export function todayContextDate(): string {
  return todayIso();
}

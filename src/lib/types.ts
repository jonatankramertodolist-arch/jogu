/** `multi` is race day itself, which spans several disciplines. */
export type Sport = 'swim' | 'bike' | 'run' | 'strength' | 'multi' | 'rest';

/** The disciplines that weekly hours are budgeted across. */
export type TrainingSport = 'swim' | 'bike' | 'run' | 'strength';

export type Intensity =
  | 'recovery'
  | 'easy'
  | 'endurance'
  | 'tempo'
  | 'threshold'
  | 'vo2'
  | 'race';

export type SessionStatus = 'planned' | 'done' | 'skipped';

/** How the athlete felt after a session. Ordered from worst to best. */
export type Feeling = 'exhausted' | 'tired' | 'ok' | 'good' | 'strong';

export type PhaseName = 'base' | 'build' | 'peak' | 'taper' | 'race';

export type RaceType =
  | 'ironman'
  | 'half-ironman'
  | 'olympic'
  | 'sprint'
  | 'marathon'
  | 'half-marathon'
  | 'other';

export interface Session {
  id: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  sport: Sport;
  title: string;
  intensity: Intensity;
  durationMin: number;
  distanceKm: number | null;
  /** The actual workout structure, e.g. "15 min uppvärmning, 3x8 min tröskel". */
  description: string;
  status: SessionStatus;
  /** Sort order within a single day. */
  order: number;
  source: 'ai' | 'user' | 'demo';
}

export interface SessionLog {
  sessionId: string;
  loggedAt: string;
  actualDurationMin: number | null;
  actualDistanceKm: number | null;
  /** Borg-style perceived exertion, 1-10. */
  rpe: number | null;
  feeling: Feeling | null;
  sleepHours: number | null;
  /** 1 = inga problem, 5 = mycket öm. */
  soreness: number | null;
  note: string;
}

/**
 * One week of the periodised outline. The outline always covers the whole
 * period from start to race; concrete sessions are only filled in for the
 * weeks nearest in time.
 */
export interface WeekPlan {
  /** Monday of the week, ISO date. */
  weekStart: string;
  weekNumber: number;
  phase: PhaseName;
  focus: string;
  totalHours: number;
  sportHours: Record<TrainingSport, number>;
  keySessions: string[];
  isRecoveryWeek: boolean;
  /** True once concrete sessions have been generated for this week. */
  detailed: boolean;
}

export interface Goal {
  raceName: string;
  raceType: RaceType;
  /** ISO date. */
  raceDate: string;
  /** ISO date the plan starts from. */
  startDate: string;
  goalTime: string;
  notes: string;
}

export interface AthleteProfile {
  name: string;
  birthYear: number | null;
  weightKg: number | null;
  /** Hours per week the athlete can realistically train. */
  weeklyHours: number;
  /** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
  availableDays: number[];
  /** Days that can hold a long session. */
  longSessionDays: number[];
  experience: 'beginner' | 'intermediate' | 'advanced';
  /** Free text per discipline, e.g. "simmar 1:45/100m, ovan i öppet vatten". */
  swimBackground: string;
  bikeBackground: string;
  runBackground: string;
  injuries: string;
  notes: string;
}

export interface Plan {
  id: string;
  createdAt: string;
  version: number;
  /** The coach's rationale for the overall structure. */
  summary: string;
  weeks: WeekPlan[];
}

/** A single change the coach wants to make to the plan. */
export interface SessionOperation {
  op: 'add' | 'update' | 'remove' | 'move';
  sessionId: string | null;
  date: string | null;
  sport: Sport | null;
  title: string | null;
  intensity: Intensity | null;
  durationMin: number | null;
  distanceKm: number | null;
  description: string | null;
  why: string;
}

export interface WeekOperation {
  weekStart: string;
  totalHours: number | null;
  focus: string | null;
  isRecoveryWeek: boolean | null;
  why: string;
}

/** Snapshot taken before an adjustment is applied, so it can be undone. */
export interface AdjustmentUndo {
  sessions: Session[];
  weeks: WeekPlan[];
}

export interface Adjustment {
  id: string;
  at: string;
  trigger: 'chat' | 'feedback';
  reasoning: string;
  message: string;
  sessionOps: SessionOperation[];
  weekOps: WeekOperation[];
  status: 'pending' | 'applied' | 'rejected' | 'undone';
  undo: AdjustmentUndo | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'coach';
  content: string;
  at: string;
  /** Set when this message carried a change proposal. */
  adjustmentId: string | null;
  /** Set when the call failed, so the UI can show it differently. */
  isError?: boolean;
}

export type CoachTone = 'gentle' | 'balanced' | 'tough';

export interface Settings {
  planningModel: string | null;
  chatModel: string | null;
  coachTone: CoachTone;
  /** How many days ahead concrete sessions should be kept filled in. */
  detailWindowDays: number;
  /**
   * How hard the athlete wants to be pushed, 0 to 100. Governs how fast volume
   * climbs and how many hard sessions a week may hold. It moves the dial inside
   * the safety rules rather than switching them off, so even 100 stays within
   * what the validator allows.
   */
  ambition: number;
}

export interface AppState {
  schemaVersion: number;
  profile: AthleteProfile;
  goal: Goal | null;
  plan: Plan | null;
  sessions: Session[];
  logs: Record<string, SessionLog>;
  adjustments: Adjustment[];
  chat: ChatMessage[];
  settings: Settings;
  /** Set when the demo plan is loaded, so the UI can say so. */
  isDemo: boolean;
}

export const SPORTS: TrainingSport[] = ['swim', 'bike', 'run', 'strength'];

export const SPORT_LABELS: Record<Sport, string> = {
  swim: 'Simning',
  bike: 'Cykel',
  run: 'Löpning',
  strength: 'Styrka',
  multi: 'Tävling',
  rest: 'Vila',
};

export const SPORT_ICONS: Record<Sport, string> = {
  swim: '🏊',
  bike: '🚴',
  run: '🏃',
  strength: '🏋️',
  multi: '🏁',
  rest: '😴',
};

export const INTENSITY_LABELS: Record<Intensity, string> = {
  recovery: 'Återhämtning',
  easy: 'Lugnt',
  endurance: 'Distans',
  tempo: 'Tempo',
  threshold: 'Tröskel',
  vo2: 'VO2max',
  race: 'Tävling',
};

/** Multiplier used to turn minutes into a comparable load number. */
export const INTENSITY_FACTOR: Record<Intensity, number> = {
  recovery: 0.55,
  easy: 0.7,
  endurance: 0.85,
  tempo: 1.0,
  threshold: 1.15,
  vo2: 1.35,
  race: 1.25,
};

export const HARD_INTENSITIES: Intensity[] = ['threshold', 'vo2', 'race'];

export const PHASE_LABELS: Record<PhaseName, string> = {
  base: 'Basperiod',
  build: 'Uppbyggnad',
  peak: 'Toppning',
  taper: 'Nedtrappning',
  race: 'Tävlingsvecka',
};

export const FEELING_LABELS: Record<Feeling, string> = {
  exhausted: 'Slutkörd',
  tired: 'Trött',
  ok: 'Okej',
  good: 'Pigg',
  strong: 'Stark',
};

export const RACE_TYPE_LABELS: Record<RaceType, string> = {
  ironman: 'Ironman (heldistans)',
  'half-ironman': 'Ironman 70.3 (halvdistans)',
  olympic: 'Olympisk distans',
  sprint: 'Sprintdistans',
  marathon: 'Marathon',
  'half-marathon': 'Halvmarathon',
  other: 'Annat',
};

export const RACE_TYPE_IS_TRIATHLON: Record<RaceType, boolean> = {
  ironman: true,
  'half-ironman': true,
  olympic: true,
  sprint: true,
  marathon: false,
  'half-marathon': false,
  other: true,
};

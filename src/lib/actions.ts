import { applyOperations } from './patch';
import { buildDemoPlan, buildWeekSessions } from './plan-builder';
import { getState, newId, replaceState, update } from './store';
import {
  type Adjustment,
  type AppState,
  type AthleteProfile,
  type ChatMessage,
  type Goal,
  type Session,
  type SessionLog,
  type SessionStatus,
  type Settings,
  type WeekPlan,
} from './types';

/** Every change to stored data goes through one of these. */

export function saveGoal(goal: Goal): void {
  update((state) => ({ ...state, goal }));
}

export function saveProfile(profile: AthleteProfile): void {
  update((state) => ({ ...state, profile }));
}

export function updateSettings(patch: Partial<Settings>): void {
  update((state) => ({ ...state, settings: { ...state.settings, ...patch } }));
}

export function loadDemoPlan(): void {
  const demo = buildDemoPlan();
  update((state) => ({
    ...state,
    goal: demo.goal,
    profile: demo.profile,
    plan: {
      id: newId(),
      createdAt: new Date().toISOString(),
      version: 1,
      summary: demo.summary,
      weeks: demo.weeks,
    },
    sessions: demo.sessions,
    logs: {},
    adjustments: [],
    chat: [],
    isDemo: true,
    settings: { ...state.settings },
  }));
}

export function clearPlan(): void {
  update((state) => ({
    ...state,
    plan: null,
    sessions: [],
    logs: {},
    adjustments: [],
    chat: [],
    isDemo: false,
  }));
}

export function savePlan(summary: string, weeks: WeekPlan[]): void {
  update((state) => ({
    ...state,
    plan: {
      id: newId(),
      createdAt: new Date().toISOString(),
      version: (state.plan?.version ?? 0) + 1,
      summary,
      weeks,
    },
    sessions: [],
    logs: {},
    adjustments: [],
    isDemo: false,
  }));
}

/** Adds generated sessions and marks the covered weeks as detailed. */
export function addSessions(sessions: Session[], weekStarts: string[]): void {
  update((state) => {
    const covered = new Set(weekStarts);
    // Replace any existing planned sessions in those weeks so re-generating a
    // week does not leave duplicates behind. Completed sessions are kept.
    const kept = state.sessions.filter((session) => {
      const monday = weekStartOf(session.date);
      if (!covered.has(monday)) return true;
      return session.status !== 'planned';
    });

    return {
      ...state,
      sessions: [...kept, ...sessions].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order,
      ),
      plan: state.plan
        ? {
            ...state.plan,
            weeks: state.plan.weeks.map((week) =>
              covered.has(week.weekStart) ? { ...week, detailed: true } : week,
            ),
          }
        : state.plan,
    };
  });
}

function weekStartOf(date: string): string {
  const parsed = new Date(date);
  const day = parsed.getDay() === 0 ? 7 : parsed.getDay();
  parsed.setDate(parsed.getDate() - (day - 1));
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fallback used when a model call fails: build the sessions locally instead. */
export function detailWeeksLocally(weeks: WeekPlan[]): number {
  const state = getState();
  if (!state.goal) return 0;
  const sessions = weeks.flatMap((week) =>
    buildWeekSessions(week, state.goal!, state.profile, 'user'),
  );
  addSessions(
    sessions,
    weeks.map((w) => w.weekStart),
  );
  return sessions.length;
}

export function setSessionStatus(sessionId: string, status: SessionStatus): void {
  update((state) => ({
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)),
  }));
}

export function logSession(log: SessionLog): void {
  update((state) => ({
    ...state,
    logs: { ...state.logs, [log.sessionId]: log },
    sessions: state.sessions.map((s) =>
      s.id === log.sessionId ? { ...s, status: 'done' } : s,
    ),
  }));
}

export function removeLog(sessionId: string): void {
  update((state) => {
    const logs = { ...state.logs };
    delete logs[sessionId];
    return {
      ...state,
      logs,
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'planned' } : s,
      ),
    };
  });
}

export function addSession(session: Omit<Session, 'id' | 'order'>): void {
  update((state) => ({
    ...state,
    sessions: [
      ...state.sessions,
      {
        ...session,
        id: newId(),
        order: state.sessions.filter((s) => s.date === session.date).length,
      },
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order)),
  }));
}

export function updateSession(sessionId: string, patch: Partial<Session>): void {
  update((state) => ({
    ...state,
    sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)),
  }));
}

export function deleteSession(sessionId: string): void {
  update((state) => {
    const logs = { ...state.logs };
    delete logs[sessionId];
    return { ...state, logs, sessions: state.sessions.filter((s) => s.id !== sessionId) };
  });
}

export function addChatMessage(
  role: ChatMessage['role'],
  content: string,
  adjustmentId: string | null = null,
  isError = false,
): string {
  const id = newId();
  update((state) => ({
    ...state,
    chat: [
      ...state.chat,
      { id, role, content, at: new Date().toISOString(), adjustmentId, isError },
    ],
  }));
  return id;
}

export function addAdjustment(adjustment: Adjustment): void {
  update((state) => ({ ...state, adjustments: [...state.adjustments, adjustment] }));
}

export function applyAdjustment(adjustmentId: string): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;

  update((state) => {
    const adjustment = state.adjustments.find((a) => a.id === adjustmentId);
    if (!adjustment || !state.plan || adjustment.status !== 'pending') return state;

    const result = applyOperations(
      state.sessions,
      state.plan.weeks,
      adjustment.sessionOps,
      adjustment.weekOps,
    );

    applied = adjustment.sessionOps.length + adjustment.weekOps.length - result.skipped.length;
    skipped = result.skipped.length;

    return {
      ...state,
      sessions: result.sessions,
      plan: { ...state.plan, weeks: result.weeks },
      adjustments: state.adjustments.map((a) =>
        a.id === adjustmentId ? { ...a, status: 'applied', undo: result.undo } : a,
      ),
    };
  });

  return { applied, skipped };
}

export function rejectAdjustment(adjustmentId: string): void {
  update((state) => ({
    ...state,
    adjustments: state.adjustments.map((a) =>
      a.id === adjustmentId && a.status === 'pending' ? { ...a, status: 'rejected' } : a,
    ),
  }));
}

export function undoAdjustment(adjustmentId: string): void {
  update((state) => {
    const adjustment = state.adjustments.find((a) => a.id === adjustmentId);
    if (!adjustment?.undo || !state.plan) return state;
    return {
      ...state,
      sessions: adjustment.undo.sessions,
      plan: { ...state.plan, weeks: adjustment.undo.weeks },
      adjustments: state.adjustments.map((a) =>
        a.id === adjustmentId ? { ...a, status: 'undone' } : a,
      ),
    };
  });
}

export function exportBackup(): string {
  const state = getState();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'jogu',
      // The API key lives outside the state on purpose, so it is never in a backup.
      state,
    },
    null,
    2,
  );
}

export function importBackup(json: string): void {
  const parsed = JSON.parse(json) as { state?: AppState } | AppState;
  const next = 'state' in parsed && parsed.state ? parsed.state : (parsed as AppState);
  if (!next || typeof next !== 'object') throw new Error('Filen ser inte ut som en säkerhetskopia.');
  replaceState(next);
}

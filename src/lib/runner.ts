import { useSyncExternalStore } from 'react';

import {
  addAdjustment,
  addChatMessage,
  addSessions,
  detailWeeksLocally,
  savePlan,
} from './actions';
import { AiError, chooseModels, listModels } from './ai/client';
import { coachTurn, detailWeeks, generateOutline } from './ai/coach';
import { getAuth } from './auth';
import { buildOutline } from './plan-builder';
import { suggestNextBlock } from './readiness';
import { getState, update } from './store';
import { weeksNeedingDetail } from './training';
import type { Issue } from './validation';
import type { Adjustment } from './types';
import type { Message as AiMessage } from './ai/client';

/**
 * Runs the long AI operations and exposes their progress. Kept outside React so
 * a call keeps running when the athlete switches tab mid-generation.
 */

interface RunnerState {
  planBusy: boolean;
  planStatus: string;
  planError: string | null;
  planIssues: Issue[];
  coachBusy: boolean;
  coachError: string | null;
}

let state: RunnerState = {
  planBusy: false,
  planStatus: '',
  planError: null,
  planIssues: [],
  coachBusy: false,
  coachError: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<RunnerState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunner(): RunnerState {
  return useSyncExternalStore(subscribe, () => state);
}

export function clearPlanError(): void {
  set({ planError: null, planIssues: [] });
}

function messageFor(error: unknown): string {
  if (error instanceof AiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Något gick fel.';
}

/**
 * Makes sure a model is chosen. Rather than hardcoding a model name that could
 * go stale, the app asks the key which models it can actually use.
 */
async function ensureModels(): Promise<{ planning: string; chat: string }> {
  const settings = getState().settings;
  if (settings.planningModel && settings.chatModel) {
    return { planning: settings.planningModel, chat: settings.chatModel };
  }

  const models = await listModels();
  if (models.length === 0) {
    throw new AiError('Nyckeln har inte tillgång till några modeller.', 'auth');
  }
  const chosen = chooseModels(models);
  const planning = settings.planningModel ?? chosen.planning!;
  const chat = settings.chatModel ?? chosen.chat!;
  update((current) => ({
    ...current,
    settings: { ...current.settings, planningModel: planning, chatModel: chat },
  }));
  return { planning, chat };
}

export interface PlanRunResult {
  ok: boolean;
  /** Anything the athlete should see before trusting the new plan. */
  issues: Issue[];
}

/**
 * Whether the AI coach can be reached. The Anthropic key now lives encrypted on
 * the server, so the coach needs an account. The plan itself does not: the
 * deterministic builder covers anyone who has not signed in yet.
 */
function coachReachable(): boolean {
  return getAuth().status === 'signed-in';
}

/**
 * Builds a plan from the rules alone. Not as tailored as the coach's, but a real
 * periodised plan, and better than leaving somebody with nothing.
 */
function planWithoutCoach(reason: string): PlanRunResult {
  const current = getState();
  if (!current.goal) return { ok: false, issues: [] };

  // Even without the coach the plan starts from what has actually been completed,
  // so a follow-up block is not handed to somebody at a volume they were already
  // missing.
  const suggestion = suggestNextBlock(current);

  savePlan(
    'Standardupplägg, byggt av appens regler.',
    buildOutline(current.goal, current.profile, { startHours: suggestion.suggestedHours }),
  );
  detailWeeksLocally(weeksNeedingDetail(getState()));

  const issues: Issue[] = [{ severity: 'warning', message: reason }];
  set({ planBusy: false, planStatus: '', planIssues: issues });
  return { ok: true, issues };
}

export async function generateFullPlan(): Promise<PlanRunResult> {
  const startState = getState();
  if (!startState.goal) {
    set({ planError: 'Sätt ett mål först.' });
    return { ok: false, issues: [] };
  }

  set({ planBusy: true, planStatus: 'Kontaktar coachen...', planError: null, planIssues: [] });

  if (!coachReachable()) {
    return planWithoutCoach(
      'Schemat är byggt utan AI-coachen, eftersom den kräver att du är inloggad. Logga in och bygg om för ett schema som är anpassat efter dig.',
    );
  }

  try {
    const models = await ensureModels();

    const outline = await generateOutline({
      model: models.planning,
      goal: startState.goal,
      profile: startState.profile,
      tone: startState.settings.coachTone,
      suggestion: suggestNextBlock(startState),
      onProgress: (planStatus) => set({ planStatus }),
    });

    savePlan(outline.summary, outline.weeks);
    set({ planIssues: outline.issues });

    await fillDetailWindow(models.chat);

    set({ planBusy: false, planStatus: '' });
    return { ok: true, issues: state.planIssues };
  } catch (error) {
    // A missing or rejected key is not a dead end, it just means the rules build
    // the plan this time.
    if (error instanceof AiError && error.kind === 'account') {
      return planWithoutCoach(`${error.message} Schemat är byggt av appens regler istället.`);
    }
    set({ planBusy: false, planStatus: '', planError: messageFor(error) });
    return { ok: false, issues: [] };
  }
}

/** Generates concrete sessions for the weeks inside the rolling detail window. */
export async function fillDetailWindow(chatModelArg?: string): Promise<number> {
  const current = getState();
  const pending = weeksNeedingDetail(current);
  if (pending.length === 0) return 0;

  if (!coachReachable()) {
    // Without the coach the plan still gets sessions, just generic ones.
    return detailWeeksLocally(pending);
  }

  const wasIdle = !state.planBusy;
  if (wasIdle) set({ planBusy: true, planError: null });

  try {
    const model = chatModelArg ?? (await ensureModels()).chat;
    const result = await detailWeeks({
      model,
      state: current,
      weeks: pending,
      onProgress: (planStatus) => set({ planStatus }),
    });

    if (result.sessions.length === 0) {
      const count = detailWeeksLocally(pending);
      if (wasIdle) set({ planBusy: false, planStatus: '' });
      return count;
    }

    addSessions(result.sessions, result.weekStarts);
    set({ planIssues: [...state.planIssues, ...result.issues] });
    if (wasIdle) set({ planBusy: false, planStatus: '' });
    return result.sessions.length;
  } catch (error) {
    if (wasIdle) set({ planBusy: false, planStatus: '', planError: messageFor(error) });
    else set({ planError: messageFor(error) });
    throw error;
  }
}

/** The last few turns of chat, so the coach has some conversational memory. */
function recentHistory(limit = 6): AiMessage[] {
  const chat = getState().chat.filter((m) => !m.isError);
  return chat.slice(-limit).map((message) => ({
    role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: message.content,
  }));
}

export async function sendToCoach(args: {
  /** What is shown in the chat log. */
  displayText: string;
  /** What is actually sent to the model, when it differs. */
  promptText?: string;
  trigger: Adjustment['trigger'];
}): Promise<void> {
  addChatMessage('user', args.displayText);

  if (!coachReachable()) {
    addChatMessage(
      'coach',
      'Jag kan inte svara utan konto, eftersom din API-nyckel förvaras säkert på servern. Logga in, så kör vi igång.',
      null,
      true,
    );
    return;
  }

  const current = getState();
  if (!current.plan || !current.goal) {
    addChatMessage(
      'coach',
      'Vi behöver ett mål och ett schema först. Gå till Mål och sätt upp ditt race.',
      null,
      true,
    );
    return;
  }

  set({ coachBusy: true, coachError: null });

  try {
    const models = await ensureModels();
    const result = await coachTurn({
      model: models.chat,
      state: current,
      userMessage: args.promptText ?? args.displayText,
      trigger: args.trigger,
      // Drop the message just added, since it is passed separately.
      history: recentHistory().slice(0, -1),
    });

    if (result.adjustment) {
      addAdjustment(result.adjustment);
      addChatMessage('coach', result.message, result.adjustment.id);
    } else {
      addChatMessage('coach', result.message);
    }

    set({ coachBusy: false });
  } catch (error) {
    const text = messageFor(error);
    addChatMessage('coach', text, null, true);
    set({ coachBusy: false, coachError: text });
  }
}

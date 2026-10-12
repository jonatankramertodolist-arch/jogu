import { newId } from './store';
import {
  SPORT_LABELS,
  type AdjustmentUndo,
  type Session,
  type SessionOperation,
  type WeekOperation,
  type WeekPlan,
} from './types';
import { formatDuration, formatWeekdayDate } from './dates';

/**
 * Applies the coach's proposed changes. Operations are applied here rather than
 * letting the model rewrite the plan, so a bad suggestion can only ever change
 * what it explicitly named, and every change can be undone.
 */

export interface PatchResult {
  sessions: Session[];
  weeks: WeekPlan[];
  undo: AdjustmentUndo;
  /** Operations that could not be applied, e.g. referencing a missing session. */
  skipped: { op: SessionOperation | WeekOperation; reason: string }[];
}

export function applyOperations(
  sessions: Session[],
  weeks: WeekPlan[],
  sessionOps: SessionOperation[],
  weekOps: WeekOperation[],
): PatchResult {
  const undo: AdjustmentUndo = {
    sessions: sessions.map((s) => ({ ...s })),
    weeks: weeks.map((w) => ({ ...w, sportHours: { ...w.sportHours } })),
  };
  const skipped: PatchResult['skipped'] = [];

  let nextSessions = sessions.map((s) => ({ ...s }));

  for (const op of sessionOps) {
    if (op.op === 'add') {
      if (!op.date || !op.sport || !op.durationMin) {
        skipped.push({ op, reason: 'Nytt pass saknar datum, sport eller längd.' });
        continue;
      }
      nextSessions.push({
        id: newId(),
        date: op.date,
        sport: op.sport,
        title: op.title ?? SPORT_LABELS[op.sport],
        intensity: op.intensity ?? 'easy',
        durationMin: op.durationMin,
        distanceKm: op.distanceKm ?? null,
        description: op.description ?? '',
        status: 'planned',
        order: nextSessions.filter((s) => s.date === op.date).length,
        source: 'ai',
      });
      continue;
    }

    const index = nextSessions.findIndex((s) => s.id === op.sessionId);
    if (index === -1) {
      skipped.push({ op, reason: 'Passet finns inte längre.' });
      continue;
    }

    const existing = nextSessions[index];
    if (existing.status === 'done') {
      skipped.push({ op, reason: 'Passet är redan genomfört och ändras inte.' });
      continue;
    }

    if (op.op === 'remove') {
      nextSessions.splice(index, 1);
      continue;
    }

    if (op.op === 'move') {
      if (!op.date) {
        skipped.push({ op, reason: 'Flytt saknar nytt datum.' });
        continue;
      }
      nextSessions[index] = {
        ...existing,
        date: op.date,
        order: nextSessions.filter((s) => s.date === op.date && s.id !== existing.id).length,
      };
      continue;
    }

    nextSessions[index] = {
      ...existing,
      date: op.date ?? existing.date,
      sport: op.sport ?? existing.sport,
      title: op.title ?? existing.title,
      intensity: op.intensity ?? existing.intensity,
      durationMin: op.durationMin ?? existing.durationMin,
      distanceKm: op.distanceKm ?? existing.distanceKm,
      description: op.description ?? existing.description,
    };
  }

  const nextWeeks = weeks.map((w) => ({ ...w, sportHours: { ...w.sportHours } }));
  for (const op of weekOps) {
    const index = nextWeeks.findIndex((w) => w.weekStart === op.weekStart);
    if (index === -1) {
      skipped.push({ op, reason: 'Veckan finns inte i planen.' });
      continue;
    }
    const week = nextWeeks[index];
    const nextHours = op.totalHours ?? week.totalHours;
    const scale = week.totalHours > 0 ? nextHours / week.totalHours : 1;
    nextWeeks[index] = {
      ...week,
      totalHours: nextHours,
      focus: op.focus ?? week.focus,
      isRecoveryWeek: op.isRecoveryWeek ?? week.isRecoveryWeek,
      sportHours: {
        swim: Math.round(week.sportHours.swim * scale * 2) / 2,
        bike: Math.round(week.sportHours.bike * scale * 2) / 2,
        run: Math.round(week.sportHours.run * scale * 2) / 2,
        strength: Math.round(week.sportHours.strength * scale * 2) / 2,
      },
    };
  }

  nextSessions = nextSessions.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order,
  );

  return { sessions: nextSessions, weeks: nextWeeks, undo, skipped };
}

/** Human-readable description of one operation, for the approval screen. */
export function describeSessionOp(op: SessionOperation, sessions: Session[]): string {
  const existing = sessions.find((s) => s.id === op.sessionId);

  if (op.op === 'add') {
    const when = op.date ? formatWeekdayDate(op.date) : 'okänd dag';
    const length = op.durationMin ? ` ${formatDuration(op.durationMin)}` : '';
    return `Nytt pass ${when}: ${op.title ?? (op.sport ? SPORT_LABELS[op.sport] : 'pass')}${length}`;
  }

  if (!existing) return 'Ändring av ett pass som inte längre finns';

  const label = `${existing.title} ${formatWeekdayDate(existing.date)}`;

  if (op.op === 'remove') return `Tas bort: ${label}`;
  if (op.op === 'move') {
    return `Flyttas: ${label} → ${op.date ? formatWeekdayDate(op.date) : 'okänd dag'}`;
  }

  const changes: string[] = [];
  if (op.durationMin != null && op.durationMin !== existing.durationMin) {
    changes.push(`${formatDuration(existing.durationMin)} → ${formatDuration(op.durationMin)}`);
  }
  if (op.intensity && op.intensity !== existing.intensity) {
    changes.push(`intensitet ${existing.intensity} → ${op.intensity}`);
  }
  if (op.sport && op.sport !== existing.sport) {
    changes.push(`${SPORT_LABELS[existing.sport]} → ${SPORT_LABELS[op.sport]}`);
  }
  if (op.date && op.date !== existing.date) {
    changes.push(`flyttas till ${formatWeekdayDate(op.date)}`);
  }
  if (op.title && op.title !== existing.title) changes.push(`ny rubrik "${op.title}"`);
  if (op.description && op.description !== existing.description) changes.push('ny beskrivning');

  return changes.length > 0 ? `${label}: ${changes.join(', ')}` : `${label}: mindre justering`;
}

export function describeWeekOp(op: WeekOperation, weeks: WeekPlan[]): string {
  const week = weeks.find((w) => w.weekStart === op.weekStart);
  if (!week) return 'Ändring av en vecka som inte finns i planen';
  const parts: string[] = [];
  if (op.totalHours != null && op.totalHours !== week.totalHours) {
    parts.push(`${week.totalHours} h → ${op.totalHours} h`);
  }
  if (op.isRecoveryWeek != null && op.isRecoveryWeek !== week.isRecoveryWeek) {
    parts.push(op.isRecoveryWeek ? 'blir återhämtningsvecka' : 'blir vanlig träningsvecka');
  }
  if (op.focus) parts.push('nytt fokus');
  return `Vecka ${week.weekNumber}: ${parts.length > 0 ? parts.join(', ') : 'mindre justering'}`;
}

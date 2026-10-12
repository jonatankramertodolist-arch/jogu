import { formatDuration } from '../lib/dates';
import {
  FEELING_LABELS,
  INTENSITY_LABELS,
  SPORT_LABELS,
  type Session,
  type SessionLog,
} from '../lib/types';
import { SPORT_BG, SPORT_TEXT } from './ui';

export default function SessionCard({
  session,
  log,
  onPress,
  showDescription = false,
}: {
  session: Session;
  log?: SessionLog;
  onPress?: () => void;
  showDescription?: boolean;
}) {
  const isDone = session.status === 'done';
  const isSkipped = session.status === 'skipped';

  return (
    <button
      type="button"
      onClick={onPress}
      className={`flex w-full gap-3 rounded-2xl border border-base-700/60 bg-base-850 p-3.5 text-left active:opacity-70 ${
        isSkipped ? 'opacity-50' : ''
      }`}
    >
      <span className={`mt-1 h-9 w-1 shrink-0 rounded-full ${SPORT_BG[session.sport]}`} />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={`text-[15px] font-semibold ${isDone || isSkipped ? 'text-muted' : 'text-white'} ${
              isSkipped ? 'line-through' : ''
            }`}
          >
            {session.title}
          </span>
          {isDone && <span className="text-[13px] text-run">✓</span>}
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <span className={SPORT_TEXT[session.sport]}>{SPORT_LABELS[session.sport]}</span>
          <span className="text-base-600">·</span>
          <span>{formatDuration(log?.actualDurationMin ?? session.durationMin)}</span>
          {session.distanceKm != null && (
            <>
              <span className="text-base-600">·</span>
              <span>{session.distanceKm.toString().replace('.', ',')} km</span>
            </>
          )}
          <span className="text-base-600">·</span>
          <span>{INTENSITY_LABELS[session.intensity]}</span>
        </span>

        {showDescription && session.description && (
          <span className="mt-2 block text-[13px] leading-relaxed text-muted">
            {session.description}
          </span>
        )}

        {log && (log.feeling || log.rpe != null || log.note) && (
          <span className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
            {log.feeling && (
              <span className="rounded-full bg-base-800 px-2 py-0.5 text-muted">
                {FEELING_LABELS[log.feeling]}
              </span>
            )}
            {log.rpe != null && (
              <span className="rounded-full bg-base-800 px-2 py-0.5 text-muted">
                RPE {log.rpe}
              </span>
            )}
            {log.note && <span className="text-faint italic">”{log.note}”</span>}
          </span>
        )}
      </span>
    </button>
  );
}

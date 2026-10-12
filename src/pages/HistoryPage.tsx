import { useNavigate } from 'react-router-dom';

import {
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  SectionLabel,
  SPORT_BG,
  SportDot,
} from '../components/ui';
import {
  addDays,
  formatDayMonthShort,
  formatDuration,
  formatHours,
  formatWeekRange,
  todayIso,
} from '../lib/dates';
import { useAppState } from '../lib/store';
import { formSnapshot, loggedSessions, weeklyHistory } from '../lib/training';
import {
  FEELING_LABELS,
  SPORTS,
  SPORT_LABELS,
  type Feeling,
  type TrainingSport,
} from '../lib/types';

/** How far back the view looks. Matches the coach's own 28-day horizon. */
const WEEKS_BACK = 4;

const FEELING_TONE: Record<Feeling, 'good' | 'neutral' | 'warn' | 'bad'> = {
  exhausted: 'bad',
  tired: 'warn',
  ok: 'neutral',
  good: 'good',
  strong: 'good',
};

function loadVerdict(ratio: number | null): { text: string; tone: 'good' | 'warn' | 'bad' } {
  if (ratio == null) return { text: 'För lite loggat än', tone: 'warn' };
  if (ratio > 1.4) return { text: 'Du har ökat snabbt', tone: 'bad' };
  if (ratio < 0.8) return { text: 'Lugnare än vanligt', tone: 'warn' };
  return { text: 'Jämn och hållbar', tone: 'good' };
}

export default function HistoryPage() {
  const state = useAppState();
  const navigate = useNavigate();
  const today = todayIso();

  if (!state.plan) {
    return (
      <Screen title="Historik" subtitle="Så har träningen faktiskt gått.">
        <EmptyState
          title="Inget att visa än"
          body="När du har ett schema och börjat logga pass samlas belastning och känsla här."
          action={<Button onClick={() => navigate('/mal')}>Sätt upp ditt race</Button>}
        />
      </Screen>
    );
  }

  const form = formSnapshot(state.sessions, state.logs, today);
  // One extra week so the current, still unfinished week is shown alongside.
  const weeks = weeklyHistory(state.sessions, state.logs, WEEKS_BACK + 1, today);
  const from = addDays(today, -27);
  const logged = loggedSessions(state.sessions, state.logs, from, today);

  const maxMin = Math.max(...weeks.map((w) => Math.max(w.plannedMin, w.completedMin)), 1);

  const sportTotals = SPORTS.reduce(
    (acc, sport) => {
      acc[sport] = weeks.reduce((sum, week) => sum + week.completedBySport[sport], 0);
      return acc;
    },
    { swim: 0, bike: 0, run: 0, strength: 0 } as Record<TrainingSport, number>,
  );
  const sportSum = SPORTS.reduce((sum, sport) => sum + sportTotals[sport], 0);

  const verdict = loadVerdict(form.loadRatio);
  const totalCompletedMin = weeks.reduce((sum, week) => sum + week.completedMin, 0);

  return (
    <Screen title="Historik" subtitle="Så har träningen faktiskt gått.">
      <SectionLabel>Nyckeltal</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3.5">
          <p className="text-[11px] tracking-wide text-faint uppercase">Belastningskvot</p>
          <p className="mt-1 text-[19px] font-bold">
            {form.loadRatio != null ? form.loadRatio.toString().replace('.', ',') : '–'}
          </p>
          <div className="mt-1.5">
            <Pill tone={verdict.tone}>{verdict.text}</Pill>
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-muted">
            {form.acuteLoad} senaste veckan mot {form.chronicLoad} i snitt per vecka.
          </p>
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] tracking-wide text-faint uppercase">Snittkänsla</p>
          <p className="mt-1 text-[19px] font-bold">
            {form.avgFeeling7d != null
              ? `${form.avgFeeling7d.toString().replace('.', ',')} / 5`
              : '–'}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
            {form.consecutiveRoughSessions > 1
              ? `${form.consecutiveRoughSessions} tunga pass i rad`
              : 'Senaste sju dagarna.'}
          </p>
          {form.avgRpe7d != null && (
            <p className="mt-1 text-[11.5px] text-muted">
              Snitt-RPE {form.avgRpe7d.toString().replace('.', ',')}
            </p>
          )}
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] tracking-wide text-faint uppercase">Genomfört</p>
          <p className="mt-1 text-[19px] font-bold">
            {form.completionRate14d != null ? `${form.completionRate14d} %` : '–'}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
            Av planerade pass senaste 14 dagarna.
          </p>
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] tracking-wide text-faint uppercase">Utan vila</p>
          <p className="mt-1 text-[19px] font-bold">{form.daysSinceRest}</p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted">
            {form.daysSinceRest >= 6
              ? 'Dags att lägga in en fri dag.'
              : 'Träningsdagar i rad just nu.'}
          </p>
        </Card>
      </div>

      <SectionLabel>Vecka för vecka</SectionLabel>
      <Card className="space-y-3.5 p-4">
        {weeks.map((week, index) => {
          const isCurrent = index === weeks.length - 1;
          const plannedShare = (week.plannedMin / maxMin) * 100;
          const completedShare = (week.completedMin / maxMin) * 100;
          return (
            <div key={week.weekStart}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px] font-medium">
                  {formatWeekRange(week.weekStart)}
                  {isCurrent && <span className="ml-1.5 text-[11px] text-run">pågående</span>}
                </p>
                <p className="text-[12.5px] text-muted">
                  {formatHours(week.completedMin / 60)}
                  <span className="text-faint"> av {formatHours(week.plannedMin / 60)}</span>
                </p>
              </div>

              <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-base-900">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-base-700"
                  style={{ width: `${plannedShare}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-run"
                  style={{ width: `${completedShare}%` }}
                />
              </div>

              <p className="mt-1 text-[11.5px] text-faint">
                {week.completedLoad > 0 ? `Belastning ${week.completedLoad}` : 'Inget loggat'}
                {week.hardSessionCount > 0 &&
                  ` · ${week.hardSessionCount} ${week.hardSessionCount === 1 ? 'hårt pass' : 'hårda pass'}`}
                {week.restDayCount > 0 &&
                  ` · ${week.restDayCount} ${week.restDayCount === 1 ? 'fri dag' : 'fria dagar'}`}
              </p>
            </div>
          );
        })}
        <p className="border-t border-base-700/60 pt-3 text-[12.5px] text-muted">
          Totalt {formatHours(totalCompletedMin / 60)} genomförd träning i perioden.
        </p>
      </Card>

      {sportSum > 0 && (
        <>
          <SectionLabel>Fördelning mellan sporterna</SectionLabel>
          <Card className="space-y-2.5 p-4">
            {SPORTS.filter((sport) => sportTotals[sport] > 0).map((sport) => {
              const share = Math.round((sportTotals[sport] / sportSum) * 100);
              return (
                <div key={sport}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-[13px]">
                      <SportDot sport={sport} />
                      {SPORT_LABELS[sport]}
                    </p>
                    <p className="text-[12.5px] text-muted">
                      {formatHours(sportTotals[sport] / 60)}
                      <span className="text-faint"> · {share} %</span>
                    </p>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-base-900">
                    <div className={`h-full rounded-full ${SPORT_BG[sport]}`} style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}

      <SectionLabel>Loggade pass</SectionLabel>
      {logged.length === 0 ? (
        <Card className="px-4 py-6 text-center">
          <p className="text-[14px] leading-relaxed text-muted">
            Du har inte loggat något pass de senaste fyra veckorna. Tryck på ett pass på Idag eller i
            Schema och välj Logga passet, så börjar coachen räkna med hur det faktiskt gick.
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-base-700/60">
          {logged.map((session) => {
            const log = state.logs[session.id];
            return (
              <div key={session.id} className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[14px] font-medium">
                      <SportDot sport={session.sport} />
                      <span className="truncate">{session.title}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-faint">
                      {formatDayMonthShort(session.date)} ·{' '}
                      {formatDuration(log.actualDurationMin ?? session.durationMin)}
                      {log.actualDistanceKm
                        ? ` · ${String(log.actualDistanceKm).replace('.', ',')} km`
                        : ''}
                      {log.rpe != null ? ` · RPE ${log.rpe}` : ''}
                    </p>
                  </div>
                  {log.feeling && (
                    <Pill tone={FEELING_TONE[log.feeling]}>{FEELING_LABELS[log.feeling]}</Pill>
                  )}
                </div>
                {log.note && (
                  <p className="mt-1.5 text-[13px] leading-snug text-muted italic">”{log.note}”</p>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

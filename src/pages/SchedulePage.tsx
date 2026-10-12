import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import SessionCard from '../components/SessionCard';
import SessionSheet from '../components/SessionSheet';
import { Button, Card, EmptyState, Pill, Screen, SectionLabel, Spinner } from '../components/ui';
import {
  addDays,
  formatDuration,
  formatWeekRange,
  startOfWeek,
  todayIso,
  weekdayShort,
} from '../lib/dates';
import { fillDetailWindow, useRunner } from '../lib/runner';
import { useAppState } from '../lib/store';
import { sessionsOnDate, weekStats } from '../lib/training';
import { PHASE_LABELS, SPORTS, SPORT_LABELS, type Session, type WeekPlan } from '../lib/types';

const SPORT_BAR: Record<string, string> = {
  swim: 'bg-swim',
  bike: 'bg-bike',
  run: 'bg-run',
  strength: 'bg-strength',
};

export default function SchedulePage() {
  const state = useAppState();
  const runner = useRunner();
  const navigate = useNavigate();
  const today = todayIso();

  const weeks = state.plan?.weeks ?? [];
  const currentIndex = useMemo(() => {
    const monday = startOfWeek(today);
    const found = weeks.findIndex((w) => w.weekStart === monday);
    return found === -1 ? 0 : found;
  }, [weeks, today]);

  const [index, setIndex] = useState(currentIndex);
  const [openSession, setOpenSession] = useState<Session | null>(null);

  if (!state.plan || weeks.length === 0) {
    return (
      <Screen title="Schema">
        <EmptyState
          title="Inget schema än"
          body="När coachen byggt din plan hittar du hela upplägget här, vecka för vecka."
          action={<Button onClick={() => navigate('/mal')}>Sätt upp mitt race</Button>}
        />
      </Screen>
    );
  }

  const week = weeks[Math.min(index, weeks.length - 1)];
  const stats = weekStats(state.sessions, state.logs, week.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week.weekStart, i));

  return (
    <Screen title="Schema" subtitle={state.goal?.raceName}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
          className="rounded-xl bg-base-850 px-3.5 py-2.5 text-[15px] disabled:opacity-30"
        >
          ‹
        </button>
        <div className="flex-1 text-center">
          <p className="text-[15px] font-semibold">Vecka {week.weekNumber}</p>
          <p className="text-[12.5px] text-muted">{formatWeekRange(week.weekStart)}</p>
        </div>
        <button
          type="button"
          disabled={index >= weeks.length - 1}
          onClick={() => setIndex(index + 1)}
          className="rounded-xl bg-base-850 px-3.5 py-2.5 text-[15px] disabled:opacity-30"
        >
          ›
        </button>
      </div>

      {index !== currentIndex && (
        <button
          type="button"
          onClick={() => setIndex(currentIndex)}
          className="mt-2 w-full text-[12.5px] text-muted underline underline-offset-2"
        >
          Tillbaka till den här veckan
        </button>
      )}

      <Card className="mt-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold">
              {PHASE_LABELS[week.phase]}
              {week.isRecoveryWeek ? ' · återhämtning' : ''}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{week.focus}</p>
          </div>
          <Pill tone={week.isRecoveryWeek ? 'accent' : 'neutral'}>{week.totalHours} h</Pill>
        </div>

        <SportBar week={week} />

        {week.keySessions.length > 0 && (
          <div className="mt-3 border-t border-base-700/60 pt-3">
            <p className="text-[11px] tracking-wide text-faint uppercase">Nyckelpass</p>
            <ul className="mt-1.5 space-y-1">
              {week.keySessions.map((key, i) => (
                <li key={i} className="text-[13px] text-white/85">
                  · {key}
                </li>
              ))}
            </ul>
          </div>
        )}

        {stats.plannedMin > 0 && (
          <p className="mt-3 border-t border-base-700/60 pt-3 text-[12.5px] text-muted">
            {formatDuration(stats.plannedMin)} utlagt
            {stats.completedMin > 0 && `, ${formatDuration(stats.completedMin)} genomfört`}
            {stats.restDayCount > 0 &&
              ` · ${stats.restDayCount} ${stats.restDayCount === 1 ? 'fri dag' : 'fria dagar'}`}
          </p>
        )}
      </Card>

      {!week.detailed && (
        <Card className="mt-3 p-4">
          <p className="text-[14.5px] font-semibold">Passen är inte utskrivna än</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Coachen skriver ut konkreta pass när veckan närmar sig, så att de kan anpassas efter hur
            din träning faktiskt gått.
          </p>
          {runner.planBusy ? (
            <div className="mt-3">
              <Spinner label={runner.planStatus || 'Arbetar...'} />
            </div>
          ) : (
            <Button variant="secondary" className="mt-3 w-full" onClick={() => void fillDetailWindow()}>
              Skriv ut passen nu
            </Button>
          )}
        </Card>
      )}

      <SectionLabel>Dag för dag</SectionLabel>
      <div className="space-y-3">
        {days.map((date) => {
          const sessions = sessionsOnDate(state.sessions, date).filter((s) => s.sport !== 'rest');
          const isToday = date === today;
          return (
            <div key={date}>
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span
                  className={`text-[12px] font-semibold tracking-wide uppercase ${
                    isToday ? 'text-run' : 'text-faint'
                  }`}
                >
                  {weekdayShort(date)} {Number(date.slice(8))}
                </span>
                {isToday && <Pill tone="good">Idag</Pill>}
              </div>

              {sessions.length > 0 ? (
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      log={state.logs[session.id]}
                      onPress={() => setOpenSession(session)}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-base-700 px-3.5 py-2.5 text-[13px] text-faint">
                  {week.detailed ? 'Fri dag' : 'Inte utskrivet än'}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <SectionLabel>Hela planen</SectionLabel>
      <PlanOverview weeks={weeks} activeWeek={week.weekStart} onSelect={(i) => setIndex(i)} />

      {state.plan.summary && (
        <>
          <SectionLabel>Coachens upplägg</SectionLabel>
          <Card className="p-4">
            <p className="text-[13.5px] leading-relaxed text-white/85">{state.plan.summary}</p>
          </Card>
        </>
      )}

      <SessionSheet
        session={openSession}
        log={openSession ? state.logs[openSession.id] : undefined}
        onClose={() => setOpenSession(null)}
      />
    </Screen>
  );
}

function SportBar({ week }: { week: WeekPlan }) {
  const total = SPORTS.reduce((sum, sport) => sum + week.sportHours[sport], 0);
  if (total <= 0) return null;

  return (
    <div className="mt-3.5">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-base-700">
        {SPORTS.map((sport) => {
          const share = (week.sportHours[sport] / total) * 100;
          if (share <= 0) return null;
          return <div key={sport} className={SPORT_BAR[sport]} style={{ width: `${share}%` }} />;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {SPORTS.filter((sport) => week.sportHours[sport] > 0).map((sport) => (
          <span key={sport} className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className={`h-2 w-2 rounded-full ${SPORT_BAR[sport]}`} />
            {SPORT_LABELS[sport]} {week.sportHours[sport].toString().replace('.', ',')} h
          </span>
        ))}
      </div>
    </div>
  );
}

function PlanOverview({
  weeks,
  activeWeek,
  onSelect,
}: {
  weeks: WeekPlan[];
  activeWeek: string;
  onSelect: (index: number) => void;
}) {
  const maxHours = Math.max(...weeks.map((w) => w.totalHours), 1);

  return (
    <Card className="p-3">
      <div className="flex items-end gap-[3px]">
        {weeks.map((week, i) => {
          const height = Math.max(6, (week.totalHours / maxHours) * 76);
          const isActive = week.weekStart === activeWeek;
          const tone =
            week.phase === 'race'
              ? 'bg-white'
              : week.phase === 'taper'
                ? 'bg-swim'
                : week.isRecoveryWeek
                  ? 'bg-base-600'
                  : week.phase === 'peak'
                    ? 'bg-run'
                    : week.phase === 'build'
                      ? 'bg-run/70'
                      : 'bg-run/45';
          return (
            <button
              key={week.weekStart}
              type="button"
              onClick={() => onSelect(i)}
              className="group flex flex-1 flex-col items-center justify-end"
              style={{ height: 84 }}
              aria-label={`Vecka ${week.weekNumber}, ${week.totalHours} timmar`}
            >
              <span
                className={`w-full rounded-sm ${tone} ${isActive ? 'ring-2 ring-white/70' : 'opacity-80'}`}
                style={{ height }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex justify-between text-[11px] text-faint">
        <span>Vecka 1</span>
        <span>Tävling</span>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-faint">
        Höjden visar veckans totala träningstid. Tryck på en stapel för att öppna veckan.
      </p>
    </Card>
  );
}

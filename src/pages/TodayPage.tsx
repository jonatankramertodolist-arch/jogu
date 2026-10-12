import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import SessionCard from '../components/SessionCard';
import SessionSheet from '../components/SessionSheet';
import { Banner, Button, Card, EmptyState, Pill, Screen, SectionLabel, Spinner } from '../components/ui';
import { loadDemoPlan } from '../lib/actions';
import { formatDuration, formatWeekdayDate, relativeDayLabel, startOfWeek, todayIso } from '../lib/dates';
import { fillDetailWindow, useRunner } from '../lib/runner';
import { useAppState } from '../lib/store';
import {
  currentWeek,
  daysToRace,
  formSnapshot,
  nextUpcomingSession,
  sessionsOnDate,
  weekStats,
  weeksNeedingDetail,
} from '../lib/training';
import { PHASE_LABELS, type Session } from '../lib/types';

export default function TodayPage() {
  const state = useAppState();
  const runner = useRunner();
  const navigate = useNavigate();
  const [openSession, setOpenSession] = useState<Session | null>(null);

  const today = todayIso();

  if (!state.goal) {
    return (
      <Screen title="Välkommen" subtitle="Din AI-coach behöver bara veta vad du siktar på.">
        <EmptyState
          title="Sätt ditt mål"
          body="Berätta vilket race du ska göra och när. Coachen bygger sedan ett träningsschema hela vägen dit, och ändrar det löpande utifrån hur du mår."
          action={
            <div className="flex flex-col gap-2">
              <Button onClick={() => navigate('/mal')}>Sätt upp mitt race</Button>
              <Button variant="ghost" onClick={loadDemoPlan}>
                Visa mig ett exempelschema först
              </Button>
            </div>
          }
        />
      </Screen>
    );
  }

  if (!state.plan) {
    return (
      <Screen title="Nästan klart" subtitle={state.goal.raceName}>
        <EmptyState
          title="Inget schema än"
          body="Målet är satt. Nu behöver coachen bygga upp veckorna från idag fram till tävlingsdagen."
          action={<Button onClick={() => navigate('/mal')}>Bygg mitt schema</Button>}
        />
      </Screen>
    );
  }

  const todaySessions = sessionsOnDate(state.sessions, today);
  const trainingToday = todaySessions.filter((s) => s.sport !== 'rest');
  const next = nextUpcomingSession(state.sessions, today);
  const week = currentWeek(state.plan, today);
  const stats = weekStats(state.sessions, state.logs, startOfWeek(today));
  const form = formSnapshot(state.sessions, state.logs, today);
  const left = daysToRace(state.goal.raceDate, today);
  const pendingAdjustments = state.adjustments.filter((a) => a.status === 'pending');
  const needDetail = weeksNeedingDetail(state);

  const progress = stats.plannedMin > 0 ? Math.min(100, (stats.completedMin / stats.plannedMin) * 100) : 0;

  return (
    <Screen
      title={relativeDayLabel(today)}
      subtitle={formatWeekdayDate(today)}
      action={
        left >= 0 ? (
          <div className="rounded-xl bg-base-850 px-3 py-2 text-right">
            <p className="text-[19px] leading-none font-bold text-run">{left}</p>
            <p className="mt-0.5 text-[10px] tracking-wide text-faint uppercase">dagar kvar</p>
          </div>
        ) : undefined
      }
    >
      {state.isDemo && (
        <Banner tone="info">
          Det här är ett exempelschema så att du ser hur appen fungerar. Gå till Mål när du vill
          bygga ditt eget.
        </Banner>
      )}

      {pendingAdjustments.length > 0 && (
        <Link to="/coach" className="mt-3 block">
          <Banner tone="warn">
            Coachen föreslår {pendingAdjustments.length === 1 ? 'en ändring' : `${pendingAdjustments.length} ändringar`} i
            ditt schema. Tryck för att titta på förslaget.
          </Banner>
        </Link>
      )}

      {runner.planBusy && (
        <Card className="mt-3 p-3.5">
          <Spinner label={runner.planStatus || 'Arbetar...'} />
        </Card>
      )}

      <SectionLabel>{trainingToday.length > 0 ? 'Dagens pass' : 'Idag'}</SectionLabel>

      {trainingToday.length > 0 ? (
        <div className="space-y-2">
          {trainingToday.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              log={state.logs[session.id]}
              showDescription
              onPress={() => setOpenSession(session)}
            />
          ))}
        </div>
      ) : (
        <Card className="p-4">
          <p className="text-[15px] font-semibold">Vilodag</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
            Ingen träning planerad idag. Vila är en del av planen, inte en lucka i den.
          </p>
          {next && (
            <p className="mt-3 text-[13.5px] text-muted">
              Nästa pass är {relativeDayLabel(next.date, today).toLowerCase()}:{' '}
              <span className="font-medium text-white">{next.title}</span>,{' '}
              {formatDuration(next.durationMin)}.
            </p>
          )}
        </Card>
      )}

      {trainingToday.length > 0 && next && next.date !== today && (
        <p className="mt-2.5 px-1 text-[13px] text-faint">
          Sen: {relativeDayLabel(next.date, today).toLowerCase()}, {next.title}
        </p>
      )}

      {week && (
        <>
          <SectionLabel>Den här veckan</SectionLabel>
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">
                  Vecka {week.weekNumber} av {state.plan.weeks.length}
                </p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {PHASE_LABELS[week.phase]}
                  {week.isRecoveryWeek ? ' · återhämtning' : ''}
                </p>
              </div>
              <Pill tone={week.isRecoveryWeek ? 'accent' : 'neutral'}>{week.totalHours} h</Pill>
            </div>

            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{week.focus}</p>

            <div className="mt-4">
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-muted">
                  {formatDuration(stats.completedMin)} av {formatDuration(stats.plannedMin)} klart
                </span>
                <span className="font-semibold text-run">{Math.round(progress)} %</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-base-700">
                <div className="h-full rounded-full bg-run transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </Card>
        </>
      )}

      {needDetail.length > 0 && !runner.planBusy && (
        <Card className="mt-3 p-4">
          <p className="text-[15px] font-semibold">Kommande veckor är inte utskrivna än</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
            {needDetail.length === 1
              ? 'En vecka i planen saknar konkreta pass.'
              : `${needDetail.length} veckor i planen saknar konkreta pass.`}{' '}
            Coachen skriver ut dem utifrån hur din träning gått hittills.
          </p>
          <Button className="mt-3 w-full" onClick={() => void fillDetailWindow()}>
            Skriv ut passen
          </Button>
        </Card>
      )}

      <div className="mt-6 mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">Nuläge</h2>
        <Link to="/historik" className="text-[12px] font-medium text-swim">
          Se historiken
        </Link>
      </div>
      <Link to="/historik" className="block active:opacity-70">
        <div className="grid grid-cols-2 gap-2">
          <Card className="p-3.5">
            <p className="text-[11px] tracking-wide text-faint uppercase">Belastning</p>
            <p className="mt-1 text-[19px] font-bold">
              {form.loadRatio != null ? form.loadRatio.toString().replace('.', ',') : '–'}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
              {form.loadRatio == null
                ? 'Logga några pass för att se trenden'
                : form.loadRatio > 1.4
                  ? 'Du har ökat snabbt senaste veckan'
                  : form.loadRatio < 0.8
                    ? 'Lugnare vecka än vanligt'
                    : 'Jämn och hållbar nivå'}
            </p>
          </Card>
          <Card className="p-3.5">
            <p className="text-[11px] tracking-wide text-faint uppercase">Känsla</p>
            <p className="mt-1 text-[19px] font-bold">
              {form.avgFeeling7d != null ? `${form.avgFeeling7d.toString().replace('.', ',')} / 5` : '–'}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
              {form.consecutiveRoughSessions > 1
                ? `${form.consecutiveRoughSessions} tunga pass i rad`
                : 'Senaste veckans snitt'}
            </p>
          </Card>
        </div>
      </Link>

      <Link
        to="/coach"
        className="mt-4 block rounded-2xl border border-base-700/60 bg-base-850 p-4 active:opacity-70"
      >
        <p className="text-[15px] font-semibold">Prata med coachen</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
          Säg hur du mår, be om att flytta ett pass eller fråga varför något ligger som det gör.
        </p>
      </Link>

      <p className="mt-6 px-1 text-center text-[11.5px] leading-relaxed text-faint">
        Tävlingsdag {formatWeekdayDate(state.goal.raceDate)}
        {left > 0 && ` · ${Math.ceil(left / 7)} veckor kvar`}
      </p>

      <SessionSheet
        session={openSession}
        log={openSession ? state.logs[openSession.id] : undefined}
        onClose={() => setOpenSession(null)}
        onAskedCoach={() => navigate('/coach')}
      />
    </Screen>
  );
}

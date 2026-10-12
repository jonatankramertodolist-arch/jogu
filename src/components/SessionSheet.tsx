import { useState } from 'react';

import { deleteSession, logSession, removeLog, setSessionStatus } from '../lib/actions';
import { feedbackPrompt } from '../lib/ai/prompts';
import { formatDuration, formatWeekdayDate } from '../lib/dates';
import { sendToCoach } from '../lib/runner';
import {
  FEELING_LABELS,
  INTENSITY_LABELS,
  SPORT_LABELS,
  type Feeling,
  type Session,
  type SessionLog,
} from '../lib/types';
import Sheet from './Sheet';
import { Button, Field, TextArea, TextInput } from './ui';

const FEELINGS: Feeling[] = ['exhausted', 'tired', 'ok', 'good', 'strong'];

export default function SessionSheet({
  session,
  log,
  onClose,
  onAskedCoach,
}: {
  session: Session | null;
  log: SessionLog | undefined;
  onClose: () => void;
  onAskedCoach?: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'log'>('view');

  if (!session) return null;

  return (
    <Sheet
      open
      title={mode === 'log' ? 'Hur gick det?' : session.title}
      onClose={() => {
        setMode('view');
        onClose();
      }}
    >
      {mode === 'view' ? (
        <SessionDetails
          session={session}
          log={log}
          onStartLog={() => setMode('log')}
          onClose={onClose}
        />
      ) : (
        <LogForm
          session={session}
          log={log}
          onDone={() => {
            setMode('view');
            onClose();
          }}
          onAskedCoach={onAskedCoach}
        />
      )}
    </Sheet>
  );
}

function SessionDetails({
  session,
  log,
  onStartLog,
  onClose,
}: {
  session: Session;
  log: SessionLog | undefined;
  onStartLog: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pb-4">
      <p className="text-[13px] text-muted">
        {formatWeekdayDate(session.date)} · {SPORT_LABELS[session.sport]} ·{' '}
        {INTENSITY_LABELS[session.intensity]}
      </p>
      <p className="mt-3 text-[22px] font-bold">{formatDuration(session.durationMin)}</p>

      {session.description && (
        <p className="mt-3 text-[15px] leading-relaxed text-white/85">{session.description}</p>
      )}

      {log && (
        <div className="mt-4 rounded-xl bg-base-850 p-3.5">
          <p className="text-[12px] font-semibold tracking-wide text-faint uppercase">Din logg</p>
          <p className="mt-1.5 text-[14px] text-white/85">
            {log.feeling ? FEELING_LABELS[log.feeling] : 'Ingen känsla angiven'}
            {log.rpe != null ? ` · RPE ${log.rpe}` : ''}
            {log.actualDurationMin ? ` · ${formatDuration(log.actualDurationMin)}` : ''}
          </p>
          {log.note && <p className="mt-1.5 text-[14px] text-muted italic">”{log.note}”</p>}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {session.status !== 'done' && (
          <Button onClick={onStartLog}>Logga passet</Button>
        )}
        {session.status === 'done' && (
          <>
            <Button variant="secondary" onClick={onStartLog}>
              Ändra loggen
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                removeLog(session.id);
                onClose();
              }}
            >
              Ångra att passet är genomfört
            </Button>
          </>
        )}
        {session.status === 'planned' && (
          <Button
            variant="secondary"
            onClick={() => {
              setSessionStatus(session.id, 'skipped');
              onClose();
            }}
          >
            Hoppade över
          </Button>
        )}
        {session.status === 'skipped' && (
          <Button
            variant="secondary"
            onClick={() => {
              setSessionStatus(session.id, 'planned');
              onClose();
            }}
          >
            Lägg tillbaka i schemat
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => {
            deleteSession(session.id);
            onClose();
          }}
        >
          Ta bort passet
        </Button>
      </div>
    </div>
  );
}

function LogForm({
  session,
  log,
  onDone,
  onAskedCoach,
}: {
  session: Session;
  log: SessionLog | undefined;
  onDone: () => void;
  onAskedCoach?: () => void;
}) {
  const [feeling, setFeeling] = useState<Feeling>(log?.feeling ?? 'ok');
  const [rpe, setRpe] = useState<number>(log?.rpe ?? 5);
  const [duration, setDuration] = useState(
    String(log?.actualDurationMin ?? session.durationMin),
  );
  const [distance, setDistance] = useState(
    log?.actualDistanceKm != null ? String(log.actualDistanceKm) : '',
  );
  const [sleep, setSleep] = useState(log?.sleepHours != null ? String(log.sleepHours) : '');
  const [soreness, setSoreness] = useState<number>(log?.soreness ?? 1);
  const [note, setNote] = useState(log?.note ?? '');
  const [askCoach, setAskCoach] = useState(true);

  const save = () => {
    const parsedDuration = Number(duration.replace(',', '.'));
    const parsedDistance = Number(distance.replace(',', '.'));
    const parsedSleep = Number(sleep.replace(',', '.'));

    logSession({
      sessionId: session.id,
      loggedAt: new Date().toISOString(),
      actualDurationMin: Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.round(parsedDuration) : null,
      actualDistanceKm: Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : null,
      rpe,
      feeling,
      sleepHours: Number.isFinite(parsedSleep) && parsedSleep > 0 ? parsedSleep : null,
      soreness,
      note: note.trim(),
    });

    if (askCoach) {
      const display = `Klarade "${session.title}". Kändes ${FEELING_LABELS[feeling].toLowerCase()}, RPE ${rpe}.${note.trim() ? ` ${note.trim()}` : ''}`;
      void sendToCoach({
        displayText: display,
        promptText: feedbackPrompt(
          session.title,
          session.date,
          FEELING_LABELS[feeling],
          rpe,
          note.trim(),
        ),
        trigger: 'feedback',
      });
      onAskedCoach?.();
    }

    onDone();
  };

  return (
    <div className="pb-4">
      <Field label="Hur kändes det?">
        <div className="flex gap-1.5">
          {FEELINGS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFeeling(option)}
              className={`flex-1 rounded-xl border px-1 py-2.5 text-[12px] font-semibold leading-tight transition-colors ${
                feeling === option
                  ? 'border-run bg-run/15 text-run'
                  : 'border-base-600 bg-base-900 text-faint'
              }`}
            >
              {FEELING_LABELS[option]}
            </button>
          ))}
        </div>
      </Field>

      <div className="mt-4">
        <Field
          label={`Ansträngning: ${rpe} av 10`}
          hint="1 är att gå långsamt, 10 är maximalt. Ett lugnt distanspass ligger oftast på 3 till 4."
        >
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={rpe}
            onChange={(event) => setRpe(Number(event.target.value))}
            className="mt-1 h-2 w-full appearance-none rounded-full bg-base-700 accent-run"
          />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Tid (min)">
          <TextInput value={duration} onChange={setDuration} inputMode="numeric" />
        </Field>
        <Field label="Distans (km)">
          <TextInput value={distance} onChange={setDistance} inputMode="decimal" placeholder="–" />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Sömn i natt (h)">
          <TextInput value={sleep} onChange={setSleep} inputMode="decimal" placeholder="–" />
        </Field>
        <Field label={`Ömhet: ${soreness} av 5`}>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={soreness}
            onChange={(event) => setSoreness(Number(event.target.value))}
            className="mt-3 h-2 w-full appearance-none rounded-full bg-base-700 accent-run"
          />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Något mer coachen bör veta?">
          <TextArea
            value={note}
            onChange={setNote}
            placeholder="Tunga ben från start, men det lossnade efter 20 minuter."
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setAskCoach(!askCoach)}
        className="mt-4 flex w-full items-center gap-3 rounded-xl bg-base-850 p-3.5 text-left"
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[12px] ${
            askCoach ? 'border-run bg-run text-base-950' : 'border-base-600'
          }`}
        >
          {askCoach ? '✓' : ''}
        </span>
        <span className="text-[14px] leading-snug">
          Låt coachen titta på det här och föreslå justeringar
        </span>
      </button>

      <Button className="mt-4 w-full" onClick={save}>
        Spara
      </Button>
    </div>
  );
}

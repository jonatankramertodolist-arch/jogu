import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AdjustmentCard from '../components/AdjustmentCard';
import { Banner, Button, EmptyState, Spinner } from '../components/ui';
import { useCoachReady } from '../lib/apikey';
import { sendToCoach, useRunner } from '../lib/runner';
import { useAppState } from '../lib/store';
import type { ChatMessage } from '../lib/types';

const STARTERS = [
  'Jag är bortrest nästa vecka och kan bara springa. Hur gör vi?',
  'Benen känns tunga sedan i lördags. Ska jag dra ner?',
  'Varför är så mycket av träningen lugn?',
  'Jag har mer tid än jag trodde. Kan vi lägga på?',
];

export default function CoachPage() {
  const state = useAppState();
  const runner = useRunner();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.chat.length, runner.coachBusy]);

  const hasKey = useCoachReady();

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || runner.coachBusy) return;
    setDraft('');
    void sendToCoach({ displayText: trimmed, trigger: 'chat' });
  };

  if (!state.plan) {
    return (
      <div className="px-4 pt-3 pb-tabbar">
        <h1 className="mb-4 text-[26px] font-bold tracking-tight">Coach</h1>
        <EmptyState
          title="Coachen behöver ett schema"
          body="Sätt upp ditt race först. Sen kan du prata med coachen om hur träningen går och justera planen tillsammans."
          action={<Button onClick={() => navigate('/mal')}>Sätt upp mitt race</Button>}
        />
      </div>
    );
  }

  return (
    <>
      <div className="px-4 pt-3 pb-tabbar">
        <h1 className="mb-1 text-[26px] font-bold tracking-tight">Coach</h1>
        <p className="mb-4 text-[13px] text-muted">
          Allt du skriver här vägs in när planen justeras.
        </p>

        {!hasKey && (
          <div className="mb-4">
            <Banner tone="warn">
              Du behöver lägga in en API-nyckel under Mer innan coachen kan svara.
            </Banner>
          </div>
        )}

        {state.chat.length === 0 ? (
          <div className="rounded-2xl border border-base-700/60 bg-base-850 p-4">
            <p className="text-[15px] leading-relaxed text-white/85">
              Hej! Jag har lagt upp din plan mot {state.goal?.raceName || 'ditt race'}. Berätta hur
              träningen känns, om något krånglar i kalendern eller om du vill förstå varför något
              ligger som det gör, så justerar vi tillsammans.
            </p>
            <div className="mt-4 space-y-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => send(starter)}
                  disabled={!hasKey}
                  className="w-full rounded-xl border border-base-600 bg-base-900 px-3.5 py-2.5 text-left text-[13.5px] leading-snug text-muted active:bg-base-800 disabled:opacity-50"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {state.chat.map((message) => (
              <Bubble key={message.id} message={message} />
            ))}
            {runner.coachBusy && (
              <div className="rounded-2xl border border-base-700/60 bg-base-850 px-4 py-3.5">
                <Spinner label="Coachen tittar på din träning..." />
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="above-tabbar fixed left-1/2 z-10 w-full max-w-lg -translate-x-1/2 border-t border-base-700/60 bg-base-900/95 px-3 py-2.5 backdrop-blur-xl">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <textarea
            value={draft}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            placeholder="Skriv till coachen..."
            className="max-h-28 flex-1 resize-none rounded-2xl border border-base-600 bg-base-850 px-3.5 py-2.5 text-white placeholder:text-faint focus:border-run focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || runner.coachBusy}
            className="h-11 w-11 shrink-0 rounded-full bg-run text-[18px] font-bold text-base-950 disabled:bg-base-700 disabled:text-faint"
            aria-label="Skicka"
          >
            ↑
          </button>
        </form>
      </div>
    </>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const state = useAppState();
  const adjustment = message.adjustmentId
    ? state.adjustments.find((a) => a.id === message.adjustmentId)
    : undefined;

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-run/15 px-3.5 py-2.5 text-[14.5px] leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className={`max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[14.5px] leading-relaxed ${
          message.isError
            ? 'border border-red-500/30 bg-red-500/10 text-red-200'
            : 'border border-base-700/60 bg-base-850 text-white/90'
        }`}
      >
        {message.content}
      </div>
      {adjustment && <AdjustmentCard adjustment={adjustment} />}
    </div>
  );
}

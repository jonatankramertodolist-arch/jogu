import { Button, Card } from './ui';
import { resolveFirstSignIn, useOnboarding } from '../lib/onboarding';

/**
 * Shown once, on the first sign-in from a browser that already holds training.
 * Both buttons say what will happen rather than just "OK", because one of them
 * throws away weeks of somebody's logged sessions.
 */
export default function ImportPrompt() {
  const onboarding = useOnboarding();
  const question = onboarding.question;
  if (!question) return null;

  const parts: string[] = [];
  if (question.localGoal) parts.push(`målet ${question.localGoal}`);
  if (question.localSessions > 0) parts.push(`${question.localSessions} pass`);
  if (question.hasLegacyKey) parts.push('din API-nyckel');

  const summary =
    parts.length === 0
      ? 'Det finns sparad data i den här webbläsaren.'
      : `I den här webbläsaren finns ${parts.join(', ')}.`;

  return (
    <div className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-[26rem]">
        <Card className="px-5 py-6">
          <h1 className="text-[20px] leading-tight font-bold">Ta med din träning?</h1>
          <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{summary}</p>

          {question.serverHasData ? (
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              Ditt konto har redan ett schema. Väljer du att ta med det som ligger här skrivs
              kontots schema över.
            </p>
          ) : (
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              Ditt konto är tomt. Tar du med det här följer träningen sedan med till alla dina
              enheter.
            </p>
          )}

          <div className="mt-6 space-y-2.5">
            <Button
              className="w-full"
              disabled={onboarding.busy}
              onClick={() => void resolveFirstSignIn('adopt')}
            >
              {onboarding.busy ? 'Flyttar…' : 'Ta med den till mitt konto'}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              disabled={onboarding.busy}
              onClick={() => void resolveFirstSignIn('discard')}
            >
              {question.serverHasData ? 'Använd kontots schema' : 'Börja om från början'}
            </Button>
          </div>

          <p className="mt-3 text-center text-[12px] leading-snug text-faint">
            Den bortvalda kopian försvinner. Är du osäker kan du avbryta, gå till Mer och spara en
            säkerhetskopia först.
          </p>
        </Card>
      </div>
    </div>
  );
}

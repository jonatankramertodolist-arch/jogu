import { useCallback, useState } from 'react';

import GoogleButton from '../components/GoogleButton';
import { Banner, Button, Card } from '../components/ui';
import { continueWithoutAccount, setAuthError, signInWithGoogle, useAuth } from '../lib/auth';

export default function LoginPage() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  const handleCredential = useCallback(async (credential: string) => {
    setBusy(true);
    try {
      await signInWithGoogle(credential);
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleError = useCallback((message: string) => setAuthError(message), []);

  return (
    <div className="flex min-h-dvh flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-[26rem]">
        <div className="mb-8 text-center">
          <span className="text-[40px]" aria-hidden>
            ⚡
          </span>
          <h1 className="mt-2 text-[30px] leading-tight font-bold tracking-tight">Jogu</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            Din AI-träningscoach. Berätta vad du siktar på, och få ett schema som ändras med dig.
          </p>
        </div>

        <Card className="px-5 py-6">
          {auth.googleClientId ? (
            <>
              <p className="mb-5 text-center text-[14px] leading-relaxed text-muted">
                Logga in så följer ditt schema med mellan telefonen och datorn. Din träning är
                bara din, ingen annan kan se den.
              </p>
              {busy ? (
                <p className="py-3 text-center text-[14px] text-muted">Loggar in…</p>
              ) : (
                <GoogleButton
                  clientId={auth.googleClientId}
                  onCredential={handleCredential}
                  onError={handleError}
                />
              )}
            </>
          ) : (
            <div className="space-y-4">
              <Banner tone="info">
                {auth.offline
                  ? 'Ingen kontakt med servern just nu, så inloggning går inte. Du kan träna vidare med det som redan finns i den här webbläsaren.'
                  : 'Inloggning med konto är inte påslaget än. Fram till dess sparas din träning i den här webbläsaren.'}
              </Banner>
            </div>
          )}

          {auth.error && (
            <div className="mt-4">
              <Banner tone="error">{auth.error}</Banner>
            </div>
          )}

          <div className="mt-6 border-t border-base-700/60 pt-5">
            <Button variant="secondary" className="w-full" onClick={continueWithoutAccount}>
              Fortsätt utan konto
            </Button>
            <p className="mt-2.5 text-center text-[12px] leading-snug text-faint">
              Sparas bara i den här webbläsaren. Rensar du webbläsardata försvinner det.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

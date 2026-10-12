import { useEffect, useRef, useState } from 'react';

/**
 * Renders Google's own sign-in button. It has to be Google's rather than one of
 * ours, because the button is what produces the signed token the server checks.
 */

interface GoogleIdApi {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }) => void;
      renderButton: (
        parent: HTMLElement,
        options: {
          type?: 'standard' | 'icon';
          theme?: string;
          size?: string;
          text?: string;
          shape?: string;
          locale?: string;
          width?: number;
        },
      ) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdApi;
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const SCRIPT_ID = 'google-identity';

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');

    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Kunde inte ladda Google.')), {
      once: true,
    });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.append(script);
    }
  });
}

export default function GoogleButton({
  clientId,
  onCredential,
  onError,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !target.current || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) onCredential(response.credential);
            else onError('Google skickade ingen inloggning tillbaka.');
          },
        });

        window.google.accounts.id.renderButton(target.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          locale: 'sv',
        });

        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onError('Kunde inte ladda Googles inloggning.');
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, onCredential, onError]);

  return (
    <div className="flex min-h-[44px] justify-center">
      <div ref={target} />
      {!ready && <span className="text-[13px] text-faint">Laddar inloggning…</span>}
    </div>
  );
}

import { useRef, useState } from 'react';

import {
  Banner,
  Button,
  Card,
  Field,
  Screen,
  SectionLabel,
  Select,
  Spinner,
  Switch,
  TextArea,
  TextInput,
} from '../components/ui';
import { clearPlan, exportBackup, importBackup, updateSettings } from '../lib/actions';
import { chooseModels, listModels, type AnthropicModel } from '../lib/ai/client';
import { removeKey, storeKey, useKeyStatus } from '../lib/apikey';
import { useAuth } from '../lib/auth';
import { buildCalendar, calendarFileName, countExportable } from '../lib/calendar';
import { todayIso } from '../lib/dates';
import { resetState, useAppState } from '../lib/store';
import { signOutAndClear, syncNow, useSyncState } from '../lib/sync';
import type { CoachTone } from '../lib/types';

function saveFile(fileName: string, mimeType: string, contents: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

const TONE_OPTIONS: { value: CoachTone; label: string }[] = [
  { value: 'gentle', label: 'Försiktig – hellre vila än riskera' },
  { value: 'balanced', label: 'Balanserad – peppar och bromsar lika delar' },
  { value: 'tough', label: 'Krävande – pushar när du har marginal' },
];

export default function SettingsPage() {
  const state = useAppState();
  const auth = useAuth();
  const keyStatus = useKeyStatus();
  const sync = useSyncState();
  const [keyDraft, setKeyDraft] = useState('');
  const [models, setModels] = useState<AnthropicModel[]>([]);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [calReminders, setCalReminders] = useState(true);
  const [calOnlyUpcoming, setCalOnlyUpcoming] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const signedIn = auth.status === 'signed-in';

  const saveKey = async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await storeKey(trimmed);
      setKeyDraft('');
      setNotice('Nyckeln är krypterad och sparad på servern.');
      await loadModels();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kunde inte spara nyckeln.');
    } finally {
      setBusy(false);
    }
  };

  const loadModels = async () => {
    setBusy(true);
    setModelStatus(null);
    try {
      const list = await listModels();
      setModels(list);
      if (!state.settings.planningModel || !state.settings.chatModel) {
        const chosen = chooseModels(list);
        updateSettings({
          planningModel: state.settings.planningModel ?? chosen.planning,
          chatModel: state.settings.chatModel ?? chosen.chat,
        });
      }
      setModelStatus(`${list.length} modeller tillgängliga.`);
    } catch (error) {
      setModelStatus(error instanceof Error ? error.message : 'Kunde inte hämta modeller.');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    saveFile(
      `jogu-backup-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
      exportBackup(),
    );
    setNotice('Säkerhetskopian är sparad som en fil.');
  };

  const downloadCalendar = () => {
    const ics = buildCalendar(state.sessions, state.goal, {
      reminders: calReminders,
      onlyUpcoming: calOnlyUpcoming,
      today: todayIso(),
    });
    saveFile(calendarFileName(state.goal), 'text/calendar', ics);
    setNotice('Kalenderfilen är skapad. Öppna den så frågar telefonen var passen ska läggas in.');
  };

  const copyBackup = async () => {
    try {
      await navigator.clipboard.writeText(exportBackup());
      setNotice('Säkerhetskopian är kopierad. Klistra in den någonstans du hittar igen.');
    } catch {
      setNotice('Kunde inte kopiera automatiskt. Använd nedladdning istället.');
    }
  };

  const runImport = (json: string) => {
    try {
      importBackup(json);
      setNotice('Säkerhetskopian är inläst.');
      setShowImport(false);
      setImportText('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Kunde inte läsa filen.');
    }
  };

  const modelOptions = models.map((model) => ({ value: model.id, label: model.display_name }));

  const syncLabel = (() => {
    if (sync.phase === 'syncing') return 'Synkar…';
    if (sync.phase === 'offline') {
      return sync.pending > 0
        ? `Ingen uppkoppling. ${sync.pending} ändringar väntar och skickas när du är online igen.`
        : 'Ingen uppkoppling just nu.';
    }
    if (sync.phase === 'error') return sync.error ?? 'Synken misslyckades.';
    if (sync.pending > 0) return `${sync.pending} ändringar väntar på att skickas.`;
    return 'Allt är sparat på ditt konto.';
  })();

  const exportableCount = countExportable(state.sessions, {
    onlyUpcoming: calOnlyUpcoming,
    today: todayIso(),
  });

  return (
    <Screen title="Mer" subtitle="Nyckel, coachens tonläge, kalender och säkerhetskopior.">
      {notice && (
        <div className="mb-4">
          <Banner tone="info">{notice}</Banner>
        </div>
      )}

      <SectionLabel>Konto</SectionLabel>
      <Card className="space-y-4 p-4">
        {signedIn && auth.user ? (
          <>
            <div>
              <p className="text-[14px] font-semibold">{auth.user.name || auth.user.email}</p>
              <p className="mt-0.5 text-[13px] text-muted">{auth.user.email}</p>
              <p className="mt-2 text-[12.5px] leading-snug text-faint">{syncLabel}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={sync.phase === 'syncing'}
                onClick={() => void syncNow()}
              >
                Synka nu
              </Button>
              <Button variant="secondary" onClick={() => void signOutAndClear()}>
                Logga ut
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[13.5px] leading-relaxed text-muted">
            Du använder Jogu utan konto, så träningen ligger bara i den här webbläsaren. Loggar du in
            följer schemat med mellan dina enheter och kan inte försvinna om du rensar webbläsaren.
          </p>
        )}
      </Card>

      <SectionLabel>API-nyckel</SectionLabel>
      <Card className="space-y-4 p-4">
        {!signedIn ? (
          <Banner tone="info">
            Nyckeln förvaras krypterad på servern och hör till ditt konto, så du behöver logga in
            för att lägga in den. Då följer den med mellan telefonen och datorn utan att du behöver
            klistra in den igen.
          </Banner>
        ) : (
          <>
            {keyStatus.connected ? (
              <div>
                <p className="text-[14px] font-semibold text-run">Nyckel är inlagd</p>
                <p className="mt-1 text-[13px] text-muted">
                  <span className="font-mono">{keyStatus.hint}</span>
                </p>
              </div>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-muted">
                Coachen behöver din egen nyckel till Claude. Den krypteras och sparas på servern,
                kopplad till ditt konto. Den visas aldrig igen, och ingen annan användare kommer åt
                den.
              </p>
            )}

            <Field label={keyStatus.connected ? 'Byt nyckel' : 'Klistra in din nyckel'}>
              <TextInput
                value={keyDraft}
                onChange={setKeyDraft}
                type="password"
                placeholder="sk-ant-..."
              />
            </Field>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!keyDraft.trim() || busy}
                onClick={() => void saveKey()}
              >
                Spara nyckeln
              </Button>
              {keyStatus.connected && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    void removeKey()
                      .then(() => {
                        setModels([]);
                        setNotice('Nyckeln är borttagen från servern.');
                      })
                      .catch(() => setNotice('Kunde inte ta bort nyckeln.'));
                  }}
                >
                  Ta bort
                </Button>
              )}
            </div>
          </>
        )}

        <div className="rounded-xl bg-base-900 p-3.5">
          <p className="text-[12px] font-semibold tracking-wide text-faint uppercase">
            Så skaffar du en nyckel
          </p>
          <ol className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
            <li>
              1. Gå till{' '}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noreferrer"
                className="text-swim underline underline-offset-2"
              >
                console.anthropic.com
              </a>{' '}
              och skapa ett konto.
            </li>
            <li>2. Fyll på med 5 till 10 dollar under Billing.</li>
            <li>3. Gå till API keys och skapa en nyckel.</li>
            <li>4. Kopiera nyckeln och klistra in den här ovanför.</li>
          </ol>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-faint">
            Att bygga ett helt schema kostar några kronor. Vanliga samtal med coachen kostar bråkdelar
            av en krona styck.
          </p>
        </div>
      </Card>

      <SectionLabel>Modell</SectionLabel>
      <Card className="space-y-4 p-4">
        {models.length === 0 ? (
          <>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Appen frågar din nyckel vilka modeller den har tillgång till, så du aldrig sitter fast
              med ett namn som slutat gälla.
            </p>
            <Button
              variant="secondary"
              disabled={!keyStatus.connected || busy}
              onClick={() => void loadModels()}
            >
              {busy ? 'Hämtar...' : 'Hämta tillgängliga modeller'}
            </Button>
          </>
        ) : (
          <>
            <Field
              label="Modell för att bygga planen"
              hint="En starkare modell ger bättre periodisering. Används sällan."
            >
              <Select
                value={state.settings.planningModel ?? modelOptions[0].value}
                onChange={(planningModel) => updateSettings({ planningModel })}
                options={modelOptions}
              />
            </Field>
            <Field
              label="Modell för samtal och justeringar"
              hint="En snabbare och billigare modell räcker gott här."
            >
              <Select
                value={state.settings.chatModel ?? modelOptions[0].value}
                onChange={(chatModel) => updateSettings({ chatModel })}
                options={modelOptions}
              />
            </Field>
          </>
        )}
        {modelStatus && <p className="text-[12.5px] text-muted">{modelStatus}</p>}
        {busy && <Spinner />}
      </Card>

      <SectionLabel>Coachen</SectionLabel>
      <Card className="space-y-4 p-4">
        <Field label="Tonläge">
          <Select
            value={state.settings.coachTone}
            onChange={(coachTone) => updateSettings({ coachTone })}
            options={TONE_OPTIONS}
          />
        </Field>

        <Field
          label={`Skriver ut pass ${state.settings.detailWindowDays} dagar framåt`}
          hint="Planen är alltid komplett på veckonivå. Konkreta pass skrivs ut för den närmaste tiden, så de kan anpassas efter hur du mår."
        >
          <input
            type="range"
            min={7}
            max={56}
            step={7}
            value={state.settings.detailWindowDays}
            onChange={(event) =>
              updateSettings({ detailWindowDays: Number(event.target.value) })
            }
            className="mt-1 h-2 w-full appearance-none rounded-full bg-base-700 accent-run"
          />
        </Field>
      </Card>

      <SectionLabel>Kalender</SectionLabel>
      <Card className="space-y-4 p-4">
        <p className="text-[13.5px] leading-relaxed text-muted">
          En hemsida kan inte påminna dig av sig själv, den skulle behöva vara öppen just då. Lägg
          istället passen i telefonens egen kalender, så får du riktiga påminnelser på låsskärmen.
        </p>

        <Switch
          label="Påminnelse på passdagen"
          hint="Klockan 07 på morgonen."
          checked={calReminders}
          onChange={setCalReminders}
        />
        <Switch
          label="Bara pass framåt i tiden"
          hint="Hoppar över det du redan gjort eller skippat."
          checked={calOnlyUpcoming}
          onChange={setCalOnlyUpcoming}
        />

        <Button disabled={exportableCount === 0} onClick={downloadCalendar}>
          {exportableCount === 0
            ? 'Inga pass att lägga in än'
            : `Lägg ${exportableCount} pass i kalendern`}
        </Button>

        <p className="text-[12.5px] leading-relaxed text-faint">
          Ändrar coachen schemat senare gör du en ny export. Passen känns igen och uppdateras i
          kalendern istället för att dubbleras.
        </p>
      </Card>

      <SectionLabel>Dina data</SectionLabel>
      <Card className="space-y-3 p-4">
        <p className="text-[13.5px] leading-relaxed text-muted">
          Allt ligger i den här webbläsaren, inget på någon server. Rensar du webbläsardata försvinner
          det, så gör en kopia med jämna mellanrum. API-nyckeln följer aldrig med i kopian.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={download}>
            Ladda ner kopia
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => void copyBackup()}>
            Kopiera
          </Button>
        </div>

        {showImport ? (
          <div className="space-y-3">
            <Field label="Klistra in en säkerhetskopia">
              <TextArea value={importText} onChange={setImportText} rows={4} placeholder="{ ... }" />
            </Field>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!importText.trim()}
                onClick={() => runImport(importText)}
              >
                Läs in
              </Button>
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                Välj fil
              </Button>
              <Button variant="ghost" onClick={() => setShowImport(false)}>
                Avbryt
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) runImport(await file.text());
              }}
            />
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setShowImport(true)}>
            Läs in en säkerhetskopia
          </Button>
        )}
      </Card>

      <Card className="mt-3 space-y-3 p-4">
        {confirmReset ? (
          <>
            <p className="text-[15px] font-semibold">Radera allt?</p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Mål, schema, loggar och chatt tas bort. Det går inte att ångra utan en säkerhetskopia.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  resetState();
                  setConfirmReset(false);
                  setNotice('Allt är raderat.');
                }}
              >
                Ja, radera
              </Button>
              <Button variant="secondary" onClick={() => setConfirmReset(false)}>
                Avbryt
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                clearPlan();
                setNotice('Schemat är borttaget. Målet finns kvar.');
              }}
            >
              Ta bort schemat men behåll målet
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(true)}>
              Radera allt
            </Button>
          </>
        )}
      </Card>

      <SectionLabel>Om appen</SectionLabel>
      <Card className="p-4">
        <p className="text-[13.5px] leading-relaxed text-muted">
          Jogu är ett planeringsverktyg, inte medicinsk rådgivning. Coachen är byggd att vara
          försiktig, men den kan inte känna skillnad på träningsvärk och en skada. Har du ont, feber
          eller känner tryck över bröstet, vila och kontakta vårdpersonal istället för att fråga
          appen.
        </p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
          Vill du dela appen med en träningskompis räcker det att skicka länken. De skapar sin egen
          nyckel och får sitt eget schema, helt skilt från ditt.
        </p>
      </Card>
    </Screen>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Banner,
  Button,
  Card,
  DayPicker,
  Field,
  Screen,
  SectionLabel,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from '../components/ui';
import { loadDemoPlan, saveGoal, saveProfile, updateSettings } from '../lib/actions';
import { useCoachReady } from '../lib/apikey';
import { daysBetween, todayIso } from '../lib/dates';
import { weekCount } from '../lib/plan-builder';
import { clearPlanError, generateFullPlan, useRunner } from '../lib/runner';
import { DEFAULT_PROFILE, useAppState } from '../lib/store';
import { errorsOnly } from '../lib/validation';
import {
  RACE_TYPE_LABELS,
  type AthleteProfile,
  type Goal,
  type RaceType,
} from '../lib/types';

const RACE_OPTIONS = (Object.keys(RACE_TYPE_LABELS) as RaceType[]).map((value) => ({
  value,
  label: RACE_TYPE_LABELS[value],
}));

const DETAIL_WINDOW_OPTIONS = [
  { value: '7', label: '7 dagar – en vecka i taget' },
  { value: '14', label: '14 dagar – två veckor' },
  { value: '21', label: '21 dagar – tre veckor' },
  { value: '28', label: '28 dagar – fyra veckor' },
  { value: '42', label: '42 dagar – sex veckor' },
  { value: '56', label: '56 dagar – åtta veckor' },
];

const EXPERIENCE_OPTIONS: { value: AthleteProfile['experience']; label: string }[] = [
  { value: 'beginner', label: 'Nybörjare – bygger fortfarande grunden' },
  { value: 'intermediate', label: 'Medelvan – tränar regelbundet sedan ett par år' },
  { value: 'advanced', label: 'Erfaren – flera lopp på distansen bakom mig' },
];

export default function GoalPage() {
  const state = useAppState();
  const runner = useRunner();
  const navigate = useNavigate();

  const [goal, setGoal] = useState<Goal>(
    state.goal ?? {
      raceName: '',
      raceType: 'ironman',
      raceDate: '',
      startDate: todayIso(),
      goalTime: '',
      notes: '',
    },
  );
  const [profile, setProfile] = useState<AthleteProfile>(state.profile ?? DEFAULT_PROFILE);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const hasKey = useCoachReady();
  const weeks = goal.raceDate && goal.startDate ? weekCount(goal) : 0;
  const daysUntil = goal.raceDate ? daysBetween(todayIso(), goal.raceDate) : null;

  const dateProblem = (() => {
    if (!goal.raceDate) return 'Fyll i tävlingsdatum.';
    if (!goal.startDate) return 'Fyll i startdatum.';
    if (goal.raceDate <= goal.startDate) return 'Tävlingsdatumet måste ligga efter startdatumet.';
    if (weeks < 2) return 'Det behöver vara minst två veckor mellan start och tävling.';
    return null;
  })();

  const canBuild = !dateProblem && profile.weeklyHours > 0 && profile.availableDays.length > 0;

  const persist = () => {
    saveGoal(goal);
    saveProfile(profile);
  };

  const build = async () => {
    clearPlanError();
    persist();
    const result = await generateFullPlan();
    // Anything worth reading is shown here rather than flashing past on the way
    // to the schedule.
    if (result.ok && result.issues.length === 0) navigate('/schema');
  };

  const planIssues = runner.planIssues;
  const hasPlanErrors = errorsOnly(planIssues).length > 0;

  return (
    <Screen title="Mål" subtitle="Det här är vad coachen bygger planen utifrån.">
      <SectionLabel>Ditt race</SectionLabel>
      <Card className="space-y-4 p-4">
        <Field label="Vilket race?">
          <TextInput
            value={goal.raceName}
            onChange={(raceName) => setGoal({ ...goal, raceName })}
            placeholder="Ironman Kalmar"
          />
        </Field>

        <Field label="Distans">
          <Select
            value={goal.raceType}
            onChange={(raceType) => setGoal({ ...goal, raceType })}
            options={RACE_OPTIONS}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Startdatum">
            <TextInput
              type="date"
              value={goal.startDate}
              onChange={(startDate) => setGoal({ ...goal, startDate })}
            />
          </Field>
          <Field label="Tävlingsdatum">
            <TextInput
              type="date"
              value={goal.raceDate}
              onChange={(raceDate) => setGoal({ ...goal, raceDate })}
            />
          </Field>
        </div>

        {weeks > 0 && !dateProblem && (
          <p className="text-[13px] text-muted">
            Det blir {weeks} veckors upplägg
            {daysUntil != null && daysUntil > 0 ? `, ${daysUntil} dagar till start` : ''}.
          </p>
        )}
        {dateProblem && <Banner tone="warn">{dateProblem}</Banner>}

        <Field label="Målsättning" hint="Frivilligt, men hjälper coachen att sätta rätt farter.">
          <TextInput
            value={goal.goalTime}
            onChange={(goalTime) => setGoal({ ...goal, goalTime })}
            placeholder="Under 12 timmar"
          />
        </Field>

        <Field label="Något mer om målet?">
          <TextArea
            value={goal.notes}
            onChange={(notes) => setGoal({ ...goal, notes })}
            placeholder="Första gången på heldistans. Kuperad bana och jag är svag på cykel i backar."
          />
        </Field>
      </Card>

      <SectionLabel>Din tid</SectionLabel>
      <Card className="space-y-4 p-4">
        <Field
          label={`Timmar per vecka: ${profile.weeklyHours}`}
          hint="Var realistisk. Coachen håller sig inom den här tiden och prioriterar hellre rätt pass än fler."
        >
          <input
            type="range"
            min={3}
            max={25}
            step={1}
            value={profile.weeklyHours}
            onChange={(event) =>
              setProfile({ ...profile, weeklyHours: Number(event.target.value) })
            }
            className="mt-1 h-2 w-full appearance-none rounded-full bg-base-700 accent-run"
          />
        </Field>

        <Field label="Dagar du kan träna">
          <DayPicker
            selected={profile.availableDays}
            onChange={(availableDays) => setProfile({ ...profile, availableDays })}
          />
        </Field>

        <Field label="Dagar som klarar långpass" hint="Oftast helgen, men du bestämmer.">
          <DayPicker
            selected={profile.longSessionDays}
            onChange={(longSessionDays) => setProfile({ ...profile, longSessionDays })}
          />
        </Field>

        <Field
          label="Hur långt fram ska passen skrivas ut?"
          hint="Veckoplanen täcker alltid hela vägen till tävlingen. Det här styr bara hur många konkreta pass som skrivs ut på en gång, så att de hinner anpassas efter hur du mår."
        >
          <Select
            value={String(state.settings.detailWindowDays)}
            onChange={(value) => updateSettings({ detailWindowDays: Number(value) })}
            options={DETAIL_WINDOW_OPTIONS}
          />
        </Field>
      </Card>

      <SectionLabel>Din bakgrund</SectionLabel>
      <Card className="space-y-4 p-4">
        <Field label="Nivå">
          <Select
            value={profile.experience}
            onChange={(experience) => setProfile({ ...profile, experience })}
            options={EXPERIENCE_OPTIONS}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Födelseår">
            <TextInput
              value={profile.birthYear?.toString() ?? ''}
              onChange={(value) =>
                setProfile({ ...profile, birthYear: value ? Number(value) : null })
              }
              inputMode="numeric"
              placeholder="1990"
            />
          </Field>
          <Field label="Vikt (kg)">
            <TextInput
              value={profile.weightKg?.toString() ?? ''}
              onChange={(value) =>
                setProfile({ ...profile, weightKg: value ? Number(value) : null })
              }
              inputMode="decimal"
              placeholder="78"
            />
          </Field>
        </div>

        <Field label="Simning" hint="Ungefärlig fart, vana i öppet vatten, det du vet.">
          <TextInput
            value={profile.swimBackground}
            onChange={(swimBackground) => setProfile({ ...profile, swimBackground })}
            placeholder="1:50 per 100 m, ovan i öppet vatten"
          />
        </Field>
        <Field label="Cykel">
          <TextInput
            value={profile.bikeBackground}
            onChange={(bikeBackground) => setProfile({ ...profile, bikeBackground })}
            placeholder="Tröskeleffekt runt 240 W"
          />
        </Field>
        <Field label="Löpning">
          <TextInput
            value={profile.runBackground}
            onChange={(runBackground) => setProfile({ ...profile, runBackground })}
            placeholder="Marathon på 3:45 förra året"
          />
        </Field>

        <Field
          label="Skador och känsliga områden"
          hint="Det här väger coachen in varje gång planen ändras."
        >
          <TextArea
            value={profile.injuries}
            onChange={(injuries) => setProfile({ ...profile, injuries })}
            placeholder="Känslig vänster hälsena om löpvolymen ökar snabbt."
          />
        </Field>

        <Field label="Övrigt coachen bör veta">
          <TextArea
            value={profile.notes}
            onChange={(notes) => setProfile({ ...profile, notes })}
            placeholder="Skiftarbete, så morgnarna varierar. Två små barn."
          />
        </Field>
      </Card>

      <div className="mt-6 space-y-3">
        {!hasKey && (
          <Banner tone="warn">
            Lägg in din API-nyckel under Mer först, annars kan coachen inte bygga planen.
          </Banner>
        )}

        {runner.planError && <Banner tone="error">{runner.planError}</Banner>}

        {planIssues.length > 0 && (
          <Card className="p-4">
            <p className="text-[15px] font-semibold">
              {hasPlanErrors ? 'Planen byggdes med anmärkningar' : 'Planen är klar, med en notering'}
            </p>
            <ul className="mt-2 space-y-1.5">
              {planIssues.slice(0, 4).map((issue, index) => (
                <li key={index} className="text-[13.5px] leading-relaxed text-muted">
                  {issue.message}
                </li>
              ))}
            </ul>
            {planIssues.length > 4 && (
              <p className="mt-1.5 text-[12.5px] text-faint">
                och {planIssues.length - 4} till.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  clearPlanError();
                  navigate('/schema');
                }}
              >
                Visa schemat ändå
              </Button>
              <Button variant="secondary" onClick={() => navigate('/coach')}>
                Fråga coachen
              </Button>
            </div>
          </Card>
        )}

        {runner.planBusy ? (
          <Card className="p-4">
            <Spinner label={runner.planStatus || 'Bygger din plan...'} />
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
              Det här tar oftast en halv till en minut. Du kan lämna sidan, arbetet fortsätter.
            </p>
          </Card>
        ) : state.plan && !confirmRebuild ? (
          <>
            <Button variant="secondary" className="w-full" onClick={() => { persist(); navigate('/schema'); }}>
              Spara ändringar
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setConfirmRebuild(true)}>
              Bygg om hela schemat från grunden
            </Button>
          </>
        ) : state.plan && confirmRebuild ? (
          <Card className="p-4">
            <p className="text-[15px] font-semibold">Bygga om från grunden?</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
              Det nuvarande schemat, dina loggade pass och chatthistoriken med coachen tas bort. Vill
              du behålla dem, gör en säkerhetskopia under Mer först.
            </p>
            <div className="mt-3 flex gap-2">
              <Button className="flex-1" disabled={!canBuild} onClick={() => void build()}>
                Ja, bygg om
              </Button>
              <Button variant="secondary" onClick={() => setConfirmRebuild(false)}>
                Avbryt
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Button className="w-full" disabled={!canBuild} onClick={() => void build()}>
              Bygg mitt schema
            </Button>
            <Button variant="ghost" className="w-full" onClick={loadDemoPlan}>
              Visa ett exempelschema istället
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}

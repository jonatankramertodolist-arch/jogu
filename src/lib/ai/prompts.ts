import {
  addDays,
  formatFullDate,
  formatWeekRange,
  formatWeekdayDate,
  todayIso,
  weekdayNameFromNumber,
} from '../dates';
import { VERDICT_BLURBS, VERDICT_LABELS, type NextBlockSuggestion } from '../readiness';
import { expectedWeekHours, formSnapshot, sessionsInRange, weekStats } from '../training';
import { MAX_WEEKLY_RAMP_PERCENT } from '../validation';
import {
  FEELING_LABELS,
  RACE_TYPE_IS_TRIATHLON,
  RACE_TYPE_LABELS,
  SPORT_LABELS,
  type AppState,
  type CoachTone,
  type Goal,
  type AthleteProfile,
  type WeekPlan,
} from '../types';

const TONE_INSTRUCTIONS: Record<CoachTone, string> = {
  gentle:
    'Ditt tonläge är stöttande och försiktigt. Du hellre backar ett pass än riskerar överbelastning, och du är generös med beröm.',
  balanced:
    'Ditt tonläge är sakligt och rakt. Du peppar när det förtjänas och bromsar när det behövs, utan att vara översvallande.',
  tough:
    'Ditt tonläge är krävande. Du accepterar att träning ska vara obekväm och pushar när atleten har marginal, men du kompromissar aldrig med faktisk överbelastning.',
};

const TRAINING_RULES = `Träningsregler du alltid följer:
- Veckovolymen ökar aldrig mer än ${MAX_WEEKLY_RAMP_PERCENT} procent jämfört med senaste ordinarie träningsveckan.
- Varje vecka innehåller minst en helt fri dag.
- Var tredje till fjärde vecka är en återhämtningsvecka med tydligt lägre volym än veckan innan.
- Högst tre hårda pass per vecka (tröskel, VO2max eller tävlingsfart). Resten ska vara lugnt.
- Ungefär 80 procent av tiden ligger i lugn aerob intensitet, 20 procent hårt.
- De sista två till tre veckorna före tävling trappas volymen ner successivt. Tävlingsveckan innehåller bara korta öppnare.
- Långpassen ligger på de dagar atleten angett att det finns tid.
- Ett långpass på cykel följt av ett kort löppass är mer värt än två separata pass, för långdistanstriathlon.
- Volymen håller sig inom den tid atleten säger att den har. Är tiden knapp prioriterar du intensitet och nyckelpass framför total volym.`;

const SAFETY_RULES = `Gränser du aldrig går över:
- Du ger inte medicinska råd och ställer inga diagnoser. Vid smärta, feber, yrsel, tryck över bröstet eller misstänkt skada rekommenderar du vila och att atleten kontaktar vårdpersonal.
- Skiljer du inte på träningsvärk och skadesmärta, utgå från det försiktiga alternativet.
- Du föreslår inga kosttillskott, läkemedel eller extrema viktmål.
- Du är ett planeringsverktyg, inte en fysioterapeut eller läkare, och säger det när frågan går utanför träningsplanering.`;

export function coachSystemPrompt(tone: CoachTone): string {
  return `Du är en erfaren uthållighetstränare som coachar en enskild atlet mot ett målrace. Du är specialiserad på triathlon och långdistanslöpning och har följt hundratals atleter genom hela byggen.

Du svarar alltid på svenska, i du-form, kort och konkret. Du skriver som en människa som pratar med en atlet, inte som en manual. Undvik punktlistor i dina svar till atleten om det inte verkligen behövs.

${TONE_INSTRUCTIONS[tone]}

${TRAINING_RULES}

${SAFETY_RULES}

Du får all mätbar data färdigräknad i underlaget. Räkna inte om den och hitta inte på siffror som inte står där.`;
}

function profileBlock(profile: AthleteProfile): string {
  const days = profile.availableDays.map(weekdayNameFromNumber).join(', ') || 'inga angivna';
  const longDays = profile.longSessionDays.map(weekdayNameFromNumber).join(', ') || 'inga angivna';
  const experience = {
    beginner: 'nybörjare',
    intermediate: 'medelvan',
    advanced: 'erfaren',
  }[profile.experience];

  const lines = [
    `Erfarenhetsnivå: ${experience}`,
    `Tillgänglig tid: ${profile.weeklyHours} timmar per vecka`,
    `Kan träna: ${days}`,
    `Dagar som klarar långpass: ${longDays}`,
  ];
  if (profile.birthYear) lines.push(`Födelseår: ${profile.birthYear}`);
  if (profile.weightKg) lines.push(`Vikt: ${profile.weightKg} kg`);
  if (profile.swimBackground) lines.push(`Simning: ${profile.swimBackground}`);
  if (profile.bikeBackground) lines.push(`Cykel: ${profile.bikeBackground}`);
  if (profile.runBackground) lines.push(`Löpning: ${profile.runBackground}`);
  if (profile.injuries) lines.push(`Skador och känsliga områden: ${profile.injuries}`);
  if (profile.notes) lines.push(`Övrigt: ${profile.notes}`);
  return lines.join('\n');
}

function goalBlock(goal: Goal, today = todayIso()): string {
  const weeks = Math.max(1, Math.ceil((new Date(goal.raceDate).getTime() - new Date(goal.startDate).getTime()) / (7 * 86_400_000)));
  const lines = [
    `Race: ${goal.raceName || 'namnlöst race'} (${RACE_TYPE_LABELS[goal.raceType]})`,
    `Tävlingsdatum: ${formatFullDate(goal.raceDate)}`,
    `Planen startar: ${formatFullDate(goal.startDate)}`,
    `Antal veckor: ${weeks}`,
    `Dagens datum: ${formatFullDate(today)}`,
  ];
  if (goal.goalTime) lines.push(`Målsättning: ${goal.goalTime}`);
  if (goal.notes) lines.push(`Atletens egna noteringar om målet: ${goal.notes}`);
  return lines.join('\n');
}

/**
 * Describes what the athlete has actually been doing, and the verdict drawn from
 * it. Without this the coach plans from the athlete's stated ambitions alone,
 * which is how a follow-up block ends up bigger than the one that was already
 * proving too much.
 */
function currentStateBlock(suggestion: NextBlockSuggestion): string {
  const { readiness, baseline } = suggestion;

  const lines = [
    readiness.uncertain
      ? 'Det finns för lite loggad träning för att läsa av formen. Utgå från atletens angivna tid och lägg dig i underkant.'
      : `Omdöme: ${VERDICT_LABELS[readiness.verdict].toUpperCase()}. ${VERDICT_BLURBS[readiness.verdict]}`,
  ];

  if (baseline.completedHoursPerWeek > 0) {
    lines.push(
      `Genomförd volym: ${baseline.completedHoursPerWeek} h i veckan de senaste ${baseline.weeksConsidered} veckorna, mot ${baseline.plannedHoursPerWeek} h planerat.`,
    );
  }

  lines.push(
    `Första veckan i den nya planen ska ligga på cirka ${suggestion.suggestedHours} h och får inte överstiga ${suggestion.suggestedHours + 0.5} h.`,
    `Högst ${readiness.maxHardSessions} hårda pass per vecka i början.`,
  );

  if (readiness.reasons.length > 0) {
    lines.push(`Det här ligger bakom omdömet:\n${readiness.reasons.map((r) => `- ${r}`).join('\n')}`);
  }

  return lines.join('\n');
}

export function outlineUserPrompt(
  goal: Goal,
  profile: AthleteProfile,
  mondays: string[],
  suggestion?: NextBlockSuggestion,
): string {
  return `Lägg upp en periodiserad veckoplan från start till tävling.

ATLETEN
${profileBlock(profile)}

MÅLET
${goalBlock(goal)}
${suggestion ? `\nNULÄGE\n${currentStateBlock(suggestion)}\n` : ''}
VECKOR SOM SKA FYLLAS
Du ska returnera exakt ${mondays.length} veckor, en för varje måndag nedan, i samma ordning:
${mondays.join('\n')}

Den sista veckan är tävlingsveckan och tävlingen ligger ${formatWeekdayDate(goal.raceDate)}.

Timmarna per sport måste summera till veckans totala timmar. Använd halvtimmar, inte finare upplösning. Håll dig inom atletens tillgängliga tid.`;
}

export function sessionsUserPrompt(
  weeks: WeekPlan[],
  goal: Goal,
  profile: AthleteProfile,
  recentContext: string,
): string {
  const today = todayIso();

  const weekBlocks = weeks
    .map((week) => {
      const days = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(week.weekStart, i);
        const weekday = i + 1;
        const tags: string[] = [];
        if (date < today) tags.push('redan passerad, lägg inga pass här');
        else if (!profile.availableDays.includes(weekday)) tags.push('kan inte träna');
        else if (profile.longSessionDays.includes(weekday)) tags.push('långpassdag');
        return `  ${date} ${weekdayNameFromNumber(weekday)}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}`;
      }).join('\n');

      const budget = expectedWeekHours(week, profile, today);
      const budgetLine =
        budget < week.totalHours
          ? `Total tid: ${week.totalHours} h för hela veckan, men veckan är redan påbörjad så lägg ut ${budget} h på dagarna som återstår`
          : `Total tid: ${week.totalHours} h`;

      return `Vecka ${week.weekNumber} (${formatWeekRange(week.weekStart)})
Fas: ${week.phase}${week.isRecoveryWeek ? ' – återhämtningsvecka' : ''}
Fokus: ${week.focus}
${budgetLine}
Simning ${week.sportHours.swim} h, cykel ${week.sportHours.bike} h, löpning ${week.sportHours.run} h, styrka ${week.sportHours.strength} h
${week.keySessions.length > 0 ? `Nyckelpass: ${week.keySessions.join('; ')}` : ''}
Dagar:
${days}`;
    })
    .join('\n\n');

  const brickRule = RACE_TYPE_IS_TRIATHLON[goal.raceType]
    ? `
En dag kan innehålla flera pass. Veckans långpass på cykel ska följas av ett kort löppass samma dag, som ett eget pass med samma datum, så att atleten vänjer sig vid att springa på trötta ben. Det löppasset är kort, oftast 10 till 25 minuter, och lugnt. Lägg också simning och styrka på samma dag som ett annat pass när veckan kräver det, hellre än att fylla varje ledig dag.`
    : '';

  return `Skriv ut konkreta pass för veckorna nedan, enligt den veckoplan som redan är bestämd.

ATLETEN
${profileBlock(profile)}

MÅLET
${goalBlock(goal)}
${recentContext ? `\nNULÄGE\n${recentContext}` : ''}

VECKOPLAN ATT FÖLJA
${weekBlocks}

Summan av passens längd per vecka ska ligga nära veckans totala tid, och fördelningen mellan sporterna ska följa veckoplanen. Veckans långpass ligger på en långpassdag. Lägg minst en helt fri dag per vecka. Beskriv varje pass så konkret att det går att genomföra utan följdfrågor.
${brickRule}

Har atleten sagt något om hur en viss veckodag ska se ut, till exempel att ett visst pass sker med en klubb, följer du det.`;
}

/**
 * A compact picture of where the athlete is right now. Deliberately short: the
 * coach gets computed numbers and the last couple of weeks, not the full history.
 */
export function athleteContext(state: AppState, today = todayIso()): string {
  const { plan, sessions, logs, profile, goal } = state;
  if (!goal) return '';

  const form = formSnapshot(sessions, logs, today);
  const lines: string[] = [];

  const daysLeft = Math.round(
    (new Date(goal.raceDate).getTime() - new Date(today).getTime()) / 86_400_000,
  );
  lines.push(`Dagar till tävling: ${daysLeft}`);

  const thisWeek = plan?.weeks.find(
    (w) => w.weekStart <= today && addDays(w.weekStart, 6) >= today,
  );
  if (thisWeek) {
    const stats = weekStats(sessions, logs, thisWeek.weekStart);
    lines.push(
      `Aktuell vecka: nummer ${thisWeek.weekNumber}, fas ${thisWeek.phase}${thisWeek.isRecoveryWeek ? ' (återhämtningsvecka)' : ''}, planerat ${thisWeek.totalHours} h, genomfört ${(stats.completedMin / 60).toFixed(1)} h av ${(stats.plannedMin / 60).toFixed(1)} h utlagt`,
    );
  }

  lines.push(
    `Belastning senaste 7 dagarna: ${form.acuteLoad} (jämfört med snittveckan senaste 4 veckorna: ${form.chronicLoad}${form.loadRatio != null ? `, kvot ${form.loadRatio}` : ''})`,
  );
  if (form.avgRpe7d != null) lines.push(`Snittansträngning (RPE 1-10) senaste veckan: ${form.avgRpe7d}`);
  if (form.avgFeeling7d != null) {
    lines.push(
      `Snittkänsla senaste veckan: ${form.avgFeeling7d} på skalan 1 slutkörd till 5 stark`,
    );
  }
  if (form.consecutiveRoughSessions > 0) {
    lines.push(
      `Antal senaste pass i rad där atleten känt sig trött eller slutkörd: ${form.consecutiveRoughSessions}`,
    );
  }
  if (form.completionRate14d != null) {
    lines.push(`Andel genomförda pass senaste 14 dagarna: ${form.completionRate14d} %`);
  }
  if (form.daysSinceRest > 0) {
    lines.push(`Antal träningsdagar i rad utan vilodag: ${form.daysSinceRest}`);
  }

  const recent = sessionsInRange(sessions, addDays(today, -14), addDays(today, -1)).filter(
    (s) => logs[s.id],
  );
  if (recent.length > 0) {
    lines.push('', 'SENASTE LOGGADE PASS');
    for (const session of recent.slice(-10)) {
      const log = logs[session.id];
      const parts = [
        `${session.date} ${SPORT_LABELS[session.sport]} "${session.title}"`,
        `planerat ${session.durationMin} min`,
      ];
      if (log.actualDurationMin) parts.push(`genomfört ${log.actualDurationMin} min`);
      if (log.rpe) parts.push(`RPE ${log.rpe}`);
      if (log.feeling) parts.push(`kändes ${FEELING_LABELS[log.feeling].toLowerCase()}`);
      if (log.sleepHours) parts.push(`sov ${log.sleepHours} h`);
      if (log.soreness) parts.push(`ömhet ${log.soreness}/5`);
      if (log.note) parts.push(`kommentar: "${log.note}"`);
      lines.push(`- ${parts.join(', ')}`);
    }
  }

  const skipped = sessionsInRange(sessions, addDays(today, -14), addDays(today, -1)).filter(
    (s) => s.status === 'skipped',
  );
  if (skipped.length > 0) {
    lines.push(
      '',
      `MISSADE PASS SENASTE TVÅ VECKORNA\n${skipped.map((s) => `- ${s.date} ${s.title}`).join('\n')}`,
    );
  }

  const upcoming = sessionsInRange(sessions, today, addDays(today, 14)).filter(
    (s) => s.status === 'planned',
  );
  if (upcoming.length > 0) {
    lines.push('', 'KOMMANDE PASS SOM DU KAN ÄNDRA (använd exakt sessionId)');
    for (const session of upcoming) {
      lines.push(
        `- sessionId ${session.id} | ${session.date} ${weekdayNameFromNumber(new Date(session.date).getDay() === 0 ? 7 : new Date(session.date).getDay())} | ${SPORT_LABELS[session.sport]} "${session.title}" | ${session.intensity} | ${session.durationMin} min`,
      );
    }
  }

  const futureWeeks = (plan?.weeks ?? []).filter((w) => w.weekStart >= today).slice(0, 6);
  if (futureWeeks.length > 0) {
    lines.push('', 'KOMMANDE VECKOR I PLANEN (weekStart som du kan ändra)');
    for (const week of futureWeeks) {
      lines.push(
        `- weekStart ${week.weekStart} | vecka ${week.weekNumber} | ${week.phase}${week.isRecoveryWeek ? ', återhämtning' : ''} | ${week.totalHours} h`,
      );
    }
  }

  lines.push('', 'ATLETEN', profileBlock(profile), '', 'MÅLET', goalBlock(goal, today));

  return lines.join('\n');
}

export function feedbackPrompt(
  sessionTitle: string,
  sessionDate: string,
  feelingLabel: string,
  rpe: number | null,
  note: string,
): string {
  const parts = [
    `Jag har just loggat passet "${sessionTitle}" den ${formatWeekdayDate(sessionDate)}.`,
    `Det kändes: ${feelingLabel.toLowerCase()}.`,
  ];
  if (rpe != null) parts.push(`Ansträngning ${rpe} av 10.`);
  if (note) parts.push(`Min kommentar: ${note}`);
  parts.push(
    'Titta på hur de senaste passen gått och justera kommande pass om det behövs. Om allt ser bra ut säger du bara det och ändrar ingenting.',
  );
  return parts.join(' ');
}

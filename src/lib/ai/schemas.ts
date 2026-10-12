/**
 * JSON schemas the model must answer through. Sport hours are flat fields
 * rather than a nested object because flat schemas come back correct far more
 * often.
 */

const PHASES = ['base', 'build', 'peak', 'taper', 'race'];
const SPORTS = ['swim', 'bike', 'run', 'strength', 'multi', 'rest'];
const INTENSITIES = ['recovery', 'easy', 'endurance', 'tempo', 'threshold', 'vo2', 'race'];

export const outlineSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'Två till fyra meningar på svenska om hur planen är upplagd och varför, riktat till atleten.',
    },
    weeks: {
      type: 'array',
      description: 'En post per vecka, från första veckan till och med tävlingsveckan.',
      items: {
        type: 'object',
        properties: {
          weekStart: { type: 'string', description: 'Måndagen i veckan, format YYYY-MM-DD.' },
          phase: { type: 'string', enum: PHASES },
          focus: {
            type: 'string',
            description: 'En kort mening på svenska om veckans syfte.',
          },
          totalHours: { type: 'number', description: 'Totalt antal träningstimmar veckan.' },
          swimHours: { type: 'number' },
          bikeHours: { type: 'number' },
          runHours: { type: 'number' },
          strengthHours: { type: 'number' },
          keySessions: {
            type: 'array',
            description: 'Ett till tre nyckelpass, kort formulerade, t.ex. "Långpass cykel 3 h".',
            items: { type: 'string' },
          },
          isRecoveryWeek: { type: 'boolean' },
        },
        required: [
          'weekStart',
          'phase',
          'focus',
          'totalHours',
          'swimHours',
          'bikeHours',
          'runHours',
          'strengthHours',
          'keySessions',
          'isRecoveryWeek',
        ],
      },
    },
  },
  required: ['summary', 'weeks'],
} as const;

export const sessionsSchema = {
  type: 'object',
  properties: {
    sessions: {
      type: 'array',
      description:
        'Ett objekt per pass. Flera pass får ha samma datum när de hör ihop, till exempel ett långpass på cykel och det korta löppasset direkt efter. Lägg dem i den ordning de ska genomföras.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD.' },
          sport: { type: 'string', enum: SPORTS },
          title: { type: 'string', description: 'Kort rubrik på svenska, t.ex. "Långpass cykel".' },
          intensity: { type: 'string', enum: INTENSITIES },
          durationMin: { type: 'number' },
          distanceKm: {
            type: 'number',
            description: 'Distans i km om det är relevant, annars 0.',
          },
          description: {
            type: 'string',
            description:
              'Passets upplägg på svenska, konkret nog att kunna genomföras utan att fråga. Ange uppvärmning, huvuddel och nedvarvning där det passar.',
          },
        },
        required: ['date', 'sport', 'title', 'intensity', 'durationMin', 'distanceKm', 'description'],
      },
    },
  },
  required: ['sessions'],
} as const;

export const coachReplySchema = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description:
        'Ditt svar till atleten på svenska. Personligt och konkret, som en coach som känner personen. Två till fem meningar om inget annat behövs.',
    },
    reasoning: {
      type: 'string',
      description:
        'En kort mening om vad i underlaget som ligger bakom ändringarna. Tom sträng om du inte föreslår några ändringar.',
    },
    sessionOps: {
      type: 'array',
      description:
        'Ändringar av enskilda pass. Lämna tom om atleten bara ställde en fråga. Använd exakta sessionId från underlaget.',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['add', 'update', 'remove', 'move'] },
          sessionId: {
            type: 'string',
            description: 'Id på passet som ändras. Tom sträng när op är "add".',
          },
          date: { type: 'string', description: 'YYYY-MM-DD, eller tom sträng om oförändrat.' },
          sport: { type: 'string', enum: [...SPORTS, ''] },
          title: { type: 'string' },
          intensity: { type: 'string', enum: [...INTENSITIES, ''] },
          durationMin: { type: 'number', description: '0 om längden inte ändras.' },
          distanceKm: { type: 'number', description: '0 om distansen inte ändras.' },
          description: { type: 'string' },
          why: {
            type: 'string',
            description: 'En kort mening på svenska om varför just den här ändringen görs.',
          },
        },
        required: ['op', 'sessionId', 'why'],
      },
    },
    weekOps: {
      type: 'array',
      description:
        'Ändringar av kommande veckors volym eller fokus. Använd bara för veckor som finns i planen.',
      items: {
        type: 'object',
        properties: {
          weekStart: { type: 'string', description: 'Måndagen i veckan, YYYY-MM-DD.' },
          totalHours: { type: 'number', description: '0 om volymen inte ändras.' },
          focus: { type: 'string' },
          isRecoveryWeek: { type: 'boolean' },
          why: { type: 'string' },
        },
        required: ['weekStart', 'why'],
      },
    },
  },
  required: ['message', 'reasoning', 'sessionOps', 'weekOps'],
} as const;

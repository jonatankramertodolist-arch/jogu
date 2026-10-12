/**
 * Exports the schedule as an iCalendar file. A plain website cannot raise a
 * reminder on its own — it would have to be open in the browser at the right
 * moment — so the sessions are handed to the phone's own calendar instead,
 * which gives real lock-screen alerts without any server involved.
 */

import { addDays, formatDuration } from './dates';
import {
  INTENSITY_LABELS,
  SPORT_ICONS,
  SPORT_LABELS,
  type Goal,
  type Session,
} from './types';

const PRODID = '-//Jogu//Traningsschema//SV';
/**
 * Suffix on every event id. The calendar app uses the id to recognise a session
 * it already holds, so changing this makes a re-export arrive as new events
 * rather than updates to the existing ones.
 */
const UID_DOMAIN = 'jogu';
/** Hour of the day the reminder fires, local time. */
const ALARM_HOUR = 7;

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * iCalendar limits a line to 75 octets, with continuations marked by a leading
 * space. Swedish characters are two bytes in UTF-8, so this counts bytes rather
 * than characters to avoid producing a file some calendar apps reject.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      // Continuation lines carry a leading space that counts toward the limit.
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) parts.push(current);

  return parts.join('\r\n ');
}

function isoToIcsDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function stamp(): string {
  return `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function sessionSummary(session: Session): string {
  const icon = SPORT_ICONS[session.sport];
  const duration = formatDuration(session.durationMin);
  return `${icon} ${session.title} · ${duration}`;
}

function sessionDescription(session: Session): string {
  const lines = [
    `${SPORT_LABELS[session.sport]} · ${INTENSITY_LABELS[session.intensity]} · ${formatDuration(session.durationMin)}`,
  ];
  if (session.distanceKm) {
    lines.push(`Distans: ${String(session.distanceKm).replace('.', ',')} km`);
  }
  if (session.description) {
    lines.push('', session.description);
  }
  return lines.join('\n');
}

function event(args: {
  uid: string;
  date: string;
  summary: string;
  description: string;
  withAlarm: boolean;
}): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${args.uid}`,
    `DTSTAMP:${stamp()}`,
    // All-day events: the schedule says which day a session belongs to, never
    // which hour, and inventing a time would be worse than leaving it open.
    `DTSTART;VALUE=DATE:${isoToIcsDate(args.date)}`,
    `DTEND;VALUE=DATE:${isoToIcsDate(addDays(args.date, 1))}`,
    `SUMMARY:${escapeText(args.summary)}`,
    `DESCRIPTION:${escapeText(args.description)}`,
    'TRANSP:TRANSPARENT',
  ];

  if (args.withAlarm) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(args.summary)}`,
      // Relative to midnight, so this lands at ALARM_HOUR on the day itself.
      `TRIGGER;RELATED=START:PT${ALARM_HOUR}H`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT');
  return lines;
}

export interface CalendarOptions {
  /** Adds a reminder to every session. */
  reminders: boolean;
  /** Leaves out sessions that have already been done or skipped. */
  onlyUpcoming: boolean;
  today: string;
}

export function buildCalendar(
  sessions: Session[],
  goal: Goal | null,
  options: CalendarOptions,
): string {
  const included = options.onlyUpcoming
    ? sessions.filter((session) => session.date >= options.today && session.status === 'planned')
    : sessions;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(goal?.raceName ? `Träning – ${goal.raceName}` : 'Träningsschema')}`,
    'X-WR-TIMEZONE:Europe/Stockholm',
  ];

  for (const session of included) {
    lines.push(
      ...event({
        uid: `${session.id}@${UID_DOMAIN}`,
        date: session.date,
        summary: sessionSummary(session),
        description: sessionDescription(session),
        withAlarm: options.reminders,
      }),
    );
  }

  if (goal) {
    lines.push(
      ...event({
        uid: `race-${goal.raceDate}@${UID_DOMAIN}`,
        date: goal.raceDate,
        summary: `🏁 ${goal.raceName}`,
        description: goal.goalTime ? `Måltid: ${goal.goalTime}` : 'Tävlingsdag.',
        withAlarm: false,
      }),
    );
  }

  lines.push('END:VCALENDAR');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function calendarFileName(goal: Goal | null): string {
  const base = goal?.raceName
    ? goal.raceName
        .toLowerCase()
        .replace(/[åä]/g, 'a')
        .replace(/ö/g, 'o')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : 'traningsschema';
  return `${base || 'traningsschema'}.ics`;
}

export function countExportable(
  sessions: Session[],
  options: Pick<CalendarOptions, 'onlyUpcoming' | 'today'>,
): number {
  if (!options.onlyUpcoming) return sessions.length;
  return sessions.filter(
    (session) => session.date >= options.today && session.status === 'planned',
  ).length;
}

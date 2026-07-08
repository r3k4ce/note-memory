const NOTE_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
  year: "numeric",
});

const COMPACT_NOTE_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatNoteDate(value: string): string {
  const date = parseDate(value);
  return date ? NOTE_DATE_FORMAT.format(date) : value;
}

export function formatCompactNoteDate(value: string): string {
  const date = parseDate(value);
  return date ? COMPACT_NOTE_DATE_FORMAT.format(date) : value;
}

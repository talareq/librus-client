import { CalendarEvent } from '../models/librus-data.models';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const PL_MONTH_WORD = new Map<string, number>([
  ['sty', 1],
  ['stycznia', 1],
  ['lut', 2],
  ['lutego', 2],
  ['mar', 3],
  ['marca', 3],
  ['kwi', 4],
  ['kwietnia', 4],
  ['maj', 5],
  ['maja', 5],
  ['cze', 6],
  ['czerwca', 6],
  ['lip', 7],
  ['lipca', 7],
  ['sie', 8],
  ['sierpnia', 8],
  ['wrz', 9],
  ['wrzesnia', 9],
  ['września', 9],
  ['paź', 10],
  ['pazdziernika', 10],
  ['października', 10],
  ['lis', 11],
  ['listopada', 11],
  ['gru', 12],
  ['grudnia', 12]
]);

/** Wyłuskuje pierwszą sensowną datę z dowolnego tekstu (PL / ISO). */
export function extractIsoDateFromStrings(...parts: string[]): string | undefined {
  const blob = parts.filter(Boolean).join('\n').trim();
  if (!blob) {
    return undefined;
  }

  let m = blob.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  m = blob.match(/\b(\d{1,2})[.](\d{1,2})[.](\d{4})\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  m = blob.match(/\b(\d{1,2})[.](\d{1,2})[.](\d{2})\b(?!\d)/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    y += y >= 70 ? 1900 : 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  const plRe =
    /\b(\d{1,2})\s+([A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)\s+(\d{4})\b/;
  m = blob.match(plRe);
  if (m) {
    const d = Number(m[1]);
    const word = m[2].toLowerCase();
    const y = Number(m[3]);
    const mo = PL_MONTH_WORD.get(word);
    if (mo !== undefined && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  return undefined;
}

/** Wszystkie dni „12 …”, „13 …” itd. przy znanym miesiącu widoku (YYYY-MM). */
export function inferIsoDatesFromContextMonth(
  title: string,
  description: string | undefined,
  contextMonth: string | undefined,
  typeLabel?: string
): string[] {
  if (!contextMonth || !/^(\d{4})-(\d{2})$/.test(contextMonth.trim())) {
    return [];
  }
  const cm = contextMonth.trim();
  const blob = `${title || ''}\n${description || ''}\n${typeLabel || ''}`.trim();
  if (!blob) {
    return [];
  }

  const lines = blob.split(/\n/).map(s => s.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines) {
    const restMatch = line.match(/^(\d{1,2})\s+(.+)/);
    if (restMatch) {
      if (/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}/.test(restMatch[2])) {
        candidates.push(restMatch[1]);
      }
      continue;
    }
    if (/^\d{1,2}$/.test(line) && /\b(egzamin|sprawdzian|kartk)/i.test(blob)) {
      candidates.push(line);
    }
    const kw = line.match(/\b(\d{1,2})\s+(egzamin|sprawdzian|kartk|classwork|test)\b/i);
    if (kw) {
      candidates.push(kw[1]);
    }
  }

  const found = new Set<string>();
  for (const c of candidates) {
    const day = Number(c);
    if (day < 1 || day > 31) {
      continue;
    }
    const [yS, moS] = cm.split('-');
    const y = Number(yS);
    const mo = Number(moS);
    if (!y || mo < 1 || mo > 12) {
      continue;
    }
    const probe = new Date(y, mo - 1, day);
    if (
      probe.getFullYear() === y &&
      probe.getMonth() === mo - 1 &&
      probe.getDate() === day
    ) {
      found.add(`${y}-${pad2(mo)}-${pad2(day)}`);
    }
  }

  return Array.from(found).sort();
}

/** Pierwszy dopasowany dzień (kompatybilność wsteczna). */
export function inferIsoFromContextMonth(
  title: string,
  description: string | undefined,
  contextMonth: string | undefined,
  typeLabel?: string
): string | undefined {
  const dates = inferIsoDatesFromContextMonth(
    title,
    description,
    contextMonth,
    typeLabel
  );
  return dates[0];
}

export function formatCalendarDatePL(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  if (!y || !mo || !d) {
    return iso;
  }
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) {
    return iso;
  }
  return dt.toLocaleDateString('pl-PL', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/** Uzupełnia dateISO / polski format daty; rozdziela wpisy z wieloma dniami (np. egzamin). */
export function enrichCalendarEvent(
  ev: CalendarEvent,
  options?: { fallbackContextMonth?: string }
): CalendarEvent[] {
  const ctxMonth = ev.contextMonth || options?.fallbackContextMonth;
  let iso =
    ev.dateISO ||
    extractIsoDateFromStrings(ev.date, ev.title, ev.description || '');
  const inferred = inferIsoDatesFromContextMonth(
    ev.title,
    ev.description,
    ctxMonth,
    ev.type
  );

  if (!iso && inferred.length === 1) {
    iso = inferred[0];
  }

  if (iso) {
    return [{ ...ev, dateISO: iso, date: formatCalendarDatePL(iso) }];
  }

  if (inferred.length > 1) {
    return inferred.map(oneIso => ({
      ...ev,
      id: `${ev.id}|${oneIso}`,
      dateISO: oneIso,
      date: formatCalendarDatePL(oneIso)
    }));
  }

  return [{ ...ev }];
}

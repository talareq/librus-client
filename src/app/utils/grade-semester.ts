import type { Grade, GradesBySubject } from '../models/librus-data.models';

export interface GradesSemesterSection {
  label: string;
  sortKey: string;
  subjects: GradesBySubject[];
}

function normalizeGradeText(s: string): string {
  return (s || '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1998 || y > 2040 || m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function tryIsoOrPlChunk(s: string): { y: number; m: number; d: number } | null {
  if (!s) {
    return null;
  }
  const t = normalizeGradeText(s);
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const y = +iso[1];
    const mo = +iso[2];
    const d = +iso[3];
    if (isValidYmd(y, mo, d)) {
      return { y, m: mo, d };
    }
  }
  /** Czasem Librus pokazuje RRRR.MM.DD w polu „Data”. */
  const isoDots = t.match(/\b(\d{4})\.(\d{2})\.(\d{2})\b/);
  if (isoDots) {
    const y = +isoDots[1];
    const mo = +isoDots[2];
    const d = +isoDots[3];
    if (isValidYmd(y, mo, d)) {
      return { y, m: mo, d };
    }
  }
  const pl = t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (pl) {
    const d = +pl[1];
    const mo = +pl[2];
    const y = +pl[3];
    /** Polska kolejność: D.M.RRRR */
    if (isValidYmd(y, mo, d)) {
      return { y, m: mo, d };
    }
  }
  return null;
}

/**
 * Najpewniejsze źródło dla semestru — linia/tooltip „Data:" / „Data oceny:".
 * Zwraca wartość po etykiecie (ISO lub D.M.RRRR).
 */
export function parseGradeExplicitDataLine(blob: string): { y: number; m: number; d: number } | null {
  const flat = normalizeGradeText(blob);
  if (!flat) {
    return null;
  }
  const split = flat.split(/\n/).map(normalizeGradeText).filter(Boolean);
  for (const line of split) {
    if (!/^Data\b/i.test(line)) {
      continue;
    }
    const afterColon = line.replace(/^Data[^:]*:\s*/i, '').trim();
    const stripped = afterColon.replace(/\s*r\.?\s*$/i, '').trim();
    const got =
      tryIsoOrPlChunk(stripped) ??
      /** „Data dodania”, „Data wyświetlenia”— i tak pierwszy token z datą w linii */
      earliestValidDateInBlob(stripped, stripped.length);
    if (got) {
      return got;
    }
  }
  /** Jedna linia bez przełamu: „Data: 06.06.2025” */
  const inline = /\bData\b[^:]{0,30}:[ \t.-]*([^\n]+)/i.exec(flat);
  if (inline) {
    const token = normalizeGradeText(inline[1]).replace(/\s*r\.?\s*$/i, '');
    const got =
      tryIsoOrPlChunk(token) ?? earliestValidDateInBlob(token, token.length);
    if (got) {
      return got;
    }
  }
  return null;
}

type YmdCand = { ymd: { y: number; m: number; d: number }; idx: number };

function pushPatternMatches(blob: string, re: RegExp, order: 'ymd' | 'dmy', bag: YmdCand[]): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) !== null) {
    let y: number;
    let mo: number;
    let d: number;
    if (order === 'ymd') {
      y = +m[1];
      mo = +m[2];
      d = +m[3];
    } else {
      d = +m[1];
      mo = +m[2];
      y = +m[3];
    }
    if (isValidYmd(y, mo, d)) {
      bag.push({ ymd: { y, m: mo, d }, idx: m.index });
    }
  }
}

/**
 * Pierwsza (wg pozycji w tekście) poprawna data — lepsza niż „ostatnie ISO w id”,
 * bo w id często jest kilka dat (rok szkolny na końcu → wszystko wpadało w sem. I).
 */
function earliestValidDateInBlob(
  blob: string,
  maxLen: number
): { y: number; m: number; d: number } | null {
  const slice = blob.slice(0, Math.min(blob.length, maxLen || blob.length));
  const cands: YmdCand[] = [];
  pushPatternMatches(slice, /\b(\d{4})-(\d{2})-(\d{2})\b/g, 'ymd', cands);
  pushPatternMatches(slice, /\b(\d{4})\.(\d{2})\.(\d{2})\b/g, 'ymd', cands);
  pushPatternMatches(slice, /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, 'dmy', cands);
  if (!cands.length) {
    return null;
  }
  cands.sort((a, b) => a.idx - b.idx);
  return cands[0].ymd;
}

/** Odczyt Y-M-D dla semestru — bez pola `dateISO` (np. przy pierwszym zapisie z scrapera). */
export function extractGradeYmdParts(
  grade: Pick<Grade, 'date' | 'description' | 'id'>
): { y: number; m: number; d: number } | null {
  const dateF = normalizeGradeText(grade.date ?? '');
  const desc = normalizeGradeText(grade.description ?? '');
  const primaryBlob = [dateF, desc].filter(Boolean).join('\n');

  const fromLabel =
    parseGradeExplicitDataLine(primaryBlob) ?? parseGradeExplicitDataLine(desc);
  if (fromLabel) {
    return fromLabel;
  }

  const fromDateField = tryIsoOrPlChunk(dateF);
  if (fromDateField) {
    return fromDateField;
  }

  const fromDescLoose =
    earliestValidDateInBlob(desc, 2000) ?? tryIsoOrPlChunk(desc);
  if (fromDescLoose) {
    return fromDescLoose;
  }

  const fromPrimaryScan = earliestValidDateInBlob(primaryBlob, 4000);
  if (fromPrimaryScan) {
    return fromPrimaryScan;
  }

  const idBlob = normalizeGradeText(grade.id ?? '');
  const fromIdLabel = parseGradeExplicitDataLine(idBlob);
  if (fromIdLabel) {
    return fromIdLabel;
  }
  /** W id często powielony tooltip — bierzemy pierwszą sensowną datę, nie ostatnią. */
  return earliestValidDateInBlob(idBlob, idBlob.length) ?? tryIsoOrPlChunk(idBlob);
}

/** Z rozparowanych ocen (`dateISO` ustawiane w `parseGrades`). */
export function extractGradeYmd(grade: Grade): { y: number; m: number; d: number } | null {
  if (grade.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(grade.dateISO)) {
    const p = grade.dateISO.split('-').map(Number);
    const [y, m, d] = p;
    if (isValidYmd(y, m, d)) {
      return { y, m, d };
    }
  }
  return extractGradeYmdParts(grade);
}

/** Zapis przy sync; stabilna data do semestrów i sortowania. */
export function deriveGradeDateISO(grade: Pick<Grade, 'date' | 'description' | 'id'>): string | undefined {
  const ymd = extractGradeYmdParts(grade);
  if (!ymd) {
    return undefined;
  }
  return `${ymd.y}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
}

function semesterBucketForYmd(ymd: { y: number; m: number; d: number }): {
  sortKey: string;
  label: string;
} {
  const { y, m } = ymd;
  const schoolYearStart = m >= 9 ? y : y - 1;
  const semester = m >= 9 || m <= 1 ? 1 : 2;
  const sortKey = `${schoolYearStart}_${semester}`;
  const label =
    semester === 1
      ? `Semestr I · ${schoolYearStart}/${schoolYearStart + 1}`
      : `Semestr II · ${schoolYearStart}/${schoolYearStart + 1}`;
  return { sortKey, label };
}

/** Nowsze pierwsze. */
export function gradeChronologicalCompare(a: Grade, b: Grade): number {
  const ia = a.dateISO ?? deriveGradeDateISO(a);
  const ib = b.dateISO ?? deriveGradeDateISO(b);
  if (ia && ib && ia !== ib) {
    return ib.localeCompare(ia);
  }
  const ya = extractGradeYmd(a);
  const yb = extractGradeYmd(b);
  if (!ya && !yb) {
    return 0;
  }
  if (!ya) {
    return 1;
  }
  if (!yb) {
    return -1;
  }
  if (ya.y !== yb.y) {
    return yb.y - ya.y;
  }
  if (ya.m !== yb.m) {
    return yb.m - ya.m;
  }
  return yb.d - ya.d;
}

export function buildGradesSemesterSections(grades: GradesBySubject[]): GradesSemesterSection[] {
  type SubjectMap = Map<string, Grade[]>;
  const buckets = new Map<string, { label: string; subjectsMap: SubjectMap }>();

  for (const grp of grades) {
    const subject = grp.subject;
    for (const g of grp.grades) {
      const ymd = extractGradeYmd(g);
      const { sortKey, label } = ymd
        ? semesterBucketForYmd(ymd)
        : { sortKey: '_unknown', label: 'Bez daty' };

      if (!buckets.has(sortKey)) {
        buckets.set(sortKey, { label, subjectsMap: new Map() });
      }
      const bucket = buckets.get(sortKey)!;
      if (!bucket.subjectsMap.has(subject)) {
        bucket.subjectsMap.set(subject, []);
      }
      bucket.subjectsMap.get(subject)!.push(g);
    }
  }

  /** Dla każdego roku szkolnego w danych pokaż oba semestry — brak wpisów = pusta sekcja. */
  const schoolYears = new Set<number>();
  for (const key of buckets.keys()) {
    if (key === '_unknown') {
      continue;
    }
    const yStart = Number(String(key).split('_')[0]);
    if (!Number.isNaN(yStart)) {
      schoolYears.add(yStart);
    }
  }
  for (const sy of schoolYears) {
    const s1 = semesterBucketForYmd({ y: sy, m: 9, d: 1 });
    const s2 = semesterBucketForYmd({ y: sy + 1, m: 2, d: 15 });
    if (!buckets.has(s1.sortKey)) {
      buckets.set(s1.sortKey, { label: s1.label, subjectsMap: new Map() });
    }
    if (!buckets.has(s2.sortKey)) {
      buckets.set(s2.sortKey, { label: s2.label, subjectsMap: new Map() });
    }
  }

  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === '_unknown') {
      return 1;
    }
    if (b === '_unknown') {
      return -1;
    }
    const [ay, am] = a.split('_').map(Number);
    const [by, bm] = b.split('_').map(Number);
    if (by !== ay) {
      return by - ay;
    }
    /** To samo lato roku szkolnego: Semestr II nad Semestrem I. */
    return bm - am;
  });

  return keys.map(sortKey => {
    const { label, subjectsMap } = buckets.get(sortKey)!;
    const subjects: GradesBySubject[] = [...subjectsMap.entries()].map(([s, gs]) => ({
      subject: s,
      grades: [...gs].sort(gradeChronologicalCompare),
    }));
    subjects.sort((a, b) => a.subject.localeCompare(b.subject, 'pl'));
    return { sortKey, label, subjects };
  });
}

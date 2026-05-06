import {
  buildGradesSemesterSections,
  deriveGradeDateISO,
  extractGradeYmdParts,
  parseGradeExplicitDataLine,
} from './grade-semester';
import type { GradesBySubject } from '../models/librus-data.models';

describe('grade-semester', () => {
  it('parseGradeExplicitDataLine: polska Data D.M.RRRR', () => {
    expect(
      parseGradeExplicitDataLine(
        'Obszar sprawdzian\nData oceny: 15.06.2025\nNauczyciel: Jan'
      )
    ).toEqual({ y: 2025, m: 6, d: 15 });
  });

  it('parseGradeExplicitDataLine: ISO', () => {
    expect(parseGradeExplicitDataLine('Data: 2026-03-10')).toEqual({
      y: 2026,
      m: 3,
      d: 10,
    });
  });

  /** W tooltipie mogą pojawić się dwie ISO; nie bierzemy ostatniej (rok szkolny na końcu). */
  it('extractGradeYmdParts: pierwsza data w idnie ostatnia', () => {
    const ymd = extractGradeYmdParts({
      date: '',
      description: '',
      id:
        'Matematyka|5|bla 2026-06-08 koniec roku 2025-09-01 x|href|1|2',
    });
    expect(ymd).toEqual({ y: 2026, m: 6, d: 8 });
  });

  it('extractGradeYmdParts: nagłówek Data oceny nad zgiełkiem ISO w id', () => {
    const ymd = extractGradeYmdParts({
      date: '',
      description: 'Data oceny:\n06.06.2025\n2025-09-01 tylko rok szkolny',
      id: 'x',
    });
    expect(ymd).toEqual({ y: 2025, m: 6, d: 6 });
  });

  it('buildGradesSemesterSections: czerwień → semestr II', () => {
    const grades: GradesBySubject[] = [
      {
        subject: 'Fizyka',
        grades: [
          {
            subject: 'Fizyka',
            value: '5',
            date: '',
            description: 'Data: 10.06.2025',
            id: '',
          },
        ],
      },
    ];
    const sections = buildGradesSemesterSections(grades);
    expect(sections.length).toBe(2);
    expect(sections.map(s => s.sortKey)).toEqual(['2024_2', '2024_1']);
    expect(sections[0].sortKey).toBe('2024_2');
    expect(sections[0].label).toContain('Semestr II');
    expect(sections[0].subjects.length).toBe(1);
    expect(sections[1].subjects.length).toBe(0);
  });

  it('deriveGradeDateISO: RRRR.MM.DD w polu Data', () => {
    expect(
      deriveGradeDateISO({ date: '2025.12.05', description: '', id: '' })
    ).toBe('2025-12-05');
  });
});

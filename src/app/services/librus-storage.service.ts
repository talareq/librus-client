import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { LibrusData, GradesBySubject, Message, Note, Announcement, CalendarEvent, Grade } from '../models/librus-data.models';
import { enrichCalendarEvent } from '../utils/calendar-parse';
import { deriveGradeDateISO } from '../utils/grade-semester';
import { devLog } from '../utils/dev-log';

@Injectable({
  providedIn: 'root'
})
export class LibrusStorageService {
  private readonly STORAGE_KEY = 'librus_data';

  constructor() {}

  async saveData(data: Partial<LibrusData>): Promise<void> {
    try {
      const existing = await this.getData();
      const updated: LibrusData = {
        ...existing,
        ...data,
        lastSync: Date.now()
      };

      await Preferences.set({
        key: this.STORAGE_KEY,
        value: JSON.stringify(updated)
      });

      devLog('💾 Dane zapisane do storage');
    } catch (error) {
      console.error('❌ Błąd zapisywania danych:', error);
      throw error;
    }
  }

  async getData(): Promise<LibrusData> {
    try {
      const { value } = await Preferences.get({ key: this.STORAGE_KEY });
      
      if (!value) {
        return this.getEmptyData();
      }

      const data = JSON.parse(value) as LibrusData;
      const fbMonth =
        data.lastSync &&
        `${new Date(data.lastSync).getFullYear()}-${String(new Date(data.lastSync).getMonth() + 1).padStart(2, '0')}`;
      if (Array.isArray(data.calendar)) {
        const expanded: CalendarEvent[] = [];
        data.calendar.forEach((e: CalendarEvent) => {
          enrichCalendarEvent(e, {
            fallbackContextMonth: fbMonth || undefined
          }).forEach(ev => expanded.push(ev));
        });
        data.calendar = expanded;
      } else {
        data.calendar = [];
      }
      return data;
    } catch (error) {
      console.error('❌ Błąd odczytu danych:', error);
      return this.getEmptyData();
    }
  }

  async clearData(): Promise<void> {
    await Preferences.remove({ key: this.STORAGE_KEY });
    devLog('🗑️ Dane wyczyszczone');
  }

  /** Uzupełnij jedną wiadomość (np. treść z API po kliknięciu) */
  async patchMessageById(id: string, patch: Partial<Message>): Promise<void> {
    const existing = await this.getData();
    const messages = existing.messages.map(m =>
      m.id === id ? { ...m, ...patch } : m
    );
    await this.saveData({ messages });
  }

  // Porównaj nowe dane z zapisanymi i oznacz co jest nowe
  async compareAndMarkNew(
    section: 'grades' | 'messages' | 'notes' | 'announcements' | 'calendar',
    newData: any[]
  ): Promise<{ data: any[]; newCount: number }> {
    const existing = await this.getData();

    if (section === 'grades') {
      return this.mergeGrades(newData as GradesBySubject[], existing.grades);
    }

    const existingData = this.getSectionData(existing, section);
    let newCount = 0;
    const cleanedNewData = section === 'calendar'
      ? newData.filter(item => this.isMeaningfulCalendarEvent(item))
      : newData;

    const markedData = cleanedNewData.map(item => {
      const isNew = !this.itemExists(item, existingData, section);
      if (isNew) {
        newCount++;
      }
      return { ...item, isNew };
    });

    const mergedData = [
      ...markedData,
      ...existingData.filter(existingItem => !this.itemExists(existingItem, markedData, section))
    ];

    return { data: mergedData, newCount };
  }

  /** Uzupełnia `dateISO` u starych rekordów po wejściu w semestry. */
  private withGradeDateISO(grade: Grade, subject: string): Grade {
    const freshISO = deriveGradeDateISO(grade);
    return {
      ...grade,
      subject,
      dateISO: freshISO,
    };
  }

  private mergeGrades(newSubjects: GradesBySubject[], existingSubjects: GradesBySubject[]): { data: GradesBySubject[]; newCount: number } {
    const existingGrades = this.flattenGrades(existingSubjects);
    const incomingKeys = new Set<string>();
    let newCount = 0;

    const mergedBySubject = new Map<string, Grade[]>();

    newSubjects.forEach(subjectGroup => {
      const subject = subjectGroup.subject;
      const grades = subjectGroup.grades.map(grade => {
        const normalizedGrade = this.withGradeDateISO(grade, subject);
        const key = this.getGradeKey(normalizedGrade);
        incomingKeys.add(key);

        const existingGrade = existingGrades.find(item => this.getGradeKey(item) === key);
        const isNew = !existingGrade;
        if (isNew) {
          newCount++;
        }

        return {
          ...normalizedGrade,
          isNew: isNew || existingGrade?.isNew || false
        };
      });

      mergedBySubject.set(subject, grades);
    });

    existingSubjects.forEach(subjectGroup => {
      const current = mergedBySubject.get(subjectGroup.subject) || [];
      const preserved = subjectGroup.grades
        .filter(grade => {
          const key = this.getGradeKey({ ...grade, subject: subjectGroup.subject });
          return !incomingKeys.has(key);
        })
        .map(grade => this.withGradeDateISO(grade, subjectGroup.subject));

      mergedBySubject.set(subjectGroup.subject, [...current, ...preserved]);
    });

    return {
      data: Array.from(mergedBySubject.entries()).map(([subject, grades]) => ({ subject, grades })),
      newCount
    };
  }

  private getSectionData(
    data: LibrusData,
    section: 'messages' | 'notes' | 'announcements' | 'calendar'
  ): any[] {
    switch (section) {
      case 'messages':
        return data.messages;
      case 'notes':
        return data.notes;
      case 'announcements':
        return data.announcements;
      case 'calendar':
        return data.calendar.filter(item => this.isMeaningfulCalendarEvent(item));
    }
  }

  private flattenGrades(gradesBySubject: GradesBySubject[]): Grade[] {
    const flattened: Grade[] = [];
    gradesBySubject.forEach(subjectGrades => {
      subjectGrades.grades.forEach(grade => {
        flattened.push({ ...grade, subject: subjectGrades.subject });
      });
    });
    return flattened;
  }

  private itemExists(item: any, existingItems: any[], section: string): boolean {
    switch (section) {
      case 'grades':
        return existingItems.some(g => this.getGradeKey(g) === this.getGradeKey(item));
      
      case 'messages':
      case 'notes':
      case 'announcements':
      case 'calendar':
        return existingItems.some(e => e.id === item.id);
      
      default:
        return false;
    }
  }

  private getGradeKey(grade: Grade): string {
    if (grade.id) {
      return grade.id.toLowerCase();
    }

    return [
      grade.subject || '',
      grade.value || '',
      grade.date || '',
      grade.description || '',
      grade.teacher || '',
      grade.category || '',
      grade.weight || ''
    ].join('|').toLowerCase();
  }

  private isMeaningfulCalendarEvent(event: CalendarEvent): boolean {
    const title = (event.title || '').trim();
    const description = (event.description || '').trim();
    const type = (event.type || '').trim();
    const combined = `${title} ${description} ${type}`.trim();

    if (!combined) {
      return false;
    }

    if (/^\d{1,2}$/.test(title) && (!description || /^\d{1,2}$/.test(description)) && (!type || /^\d{1,2}$/.test(type))) {
      return false;
    }

    if (/^\d{1,2}$/.test(event.date || '') && /^\d{1,2}$/.test(type) && /^\d{1,2}\s/.test(title)) {
      return false;
    }

    if ((event.id || '').startsWith('event_') && /^\d{1,2}$/.test(event.date || '') && /^\d{1,2}$/.test(type)) {
      return false;
    }

    return /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}/.test(combined);
  }

  private getEmptyData(): LibrusData {
    return {
      grades: [],
      messages: [],
      notes: [],
      announcements: [],
      calendar: [],
      lastSync: 0
    };
  }

  // Pobierz liczbę nowych elementów dla każdej sekcji
  async getNewCounts(): Promise<{
    grades: number;
    messages: number;
    notes: number;
    announcements: number;
    calendar: number;
  }> {
    const data = await this.getData();
    
    return {
      grades: this.flattenGrades(data.grades).filter(g => g.isNew).length,
      messages: data.messages.filter(m => m.isNew).length,
      notes: data.notes.filter(n => n.isNew).length,
      announcements: data.announcements.filter(a => a.isNew).length,
      calendar: data.calendar.filter(e => e.isNew).length
    };
  }

  // Oznacz wszystkie jako przeczytane w danej sekcji
  async markAllAsRead(section: 'grades' | 'messages' | 'notes' | 'announcements' | 'calendar'): Promise<void> {
    const data = await this.getData();

    switch (section) {
      case 'grades':
        data.grades.forEach(subjectGrades => {
          subjectGrades.grades.forEach(g => g.isNew = false);
        });
        break;
      case 'messages':
        data.messages.forEach(m => m.isNew = false);
        break;
      case 'notes':
        data.notes.forEach(n => n.isNew = false);
        break;
      case 'announcements':
        data.announcements.forEach(a => a.isNew = false);
        break;
      case 'calendar':
        data.calendar.forEach(e => e.isNew = false);
        break;
    }

    await this.saveData(data);
  }
}

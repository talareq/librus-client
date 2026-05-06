// Modele danych dla wszystkich sekcji Librusa

export interface Grade {
  id?: string;
  subject: string;
  value: string;
  description?: string;
  date?: string;
  /** YYYY-MM-DD — stabilna data do semestrów (ustawiana w parseGrades). */
  dateISO?: string;
  teacher?: string;
  weight?: string;
  category?: string;
  isNew?: boolean;
}

export interface GradesBySubject {
  subject: string;
  grades: Grade[];
}

export interface Message {
  id: string;
  sender: string;
  subject: string;
  date: string;
  isRead: boolean;
  isNew?: boolean;
  preview?: string;
  hasAttachment?: boolean;
  /** Treść (API zwraca content w Base64; możemy też uzupełnić przy otwarciu) */
  body?: string;
  /** Kod ISO z API (np. przy szczegółach) */
  sendDateIso?: string;
}

export interface Note {
  id: string;
  teacher: string;
  content: string;
  date: string;
  category?: string;
  isNew?: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  author: string;
  date: string;
  isNew?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  /** Tekst daty z Librusa lub sformatowany PL po normalizacji */
  date: string;
  /** YYYY-MM-DD — ustawiane przy parsowaniu / enrich */
  dateISO?: string;
  /** YYYY-MM — miesiąc widoku terminarza podczas scrapingu (do dopasowania „12 egzamin…” → dzień 12) */
  contextMonth?: string;
  startTime?: string;
  endTime?: string;
  type?: string;
  isNew?: boolean;
}

export interface LibrusData {
  grades: GradesBySubject[];
  messages: Message[];
  notes: Note[];
  announcements: Announcement[];
  calendar: CalendarEvent[];
  lastSync: number;
}

export interface SyncResult {
  success: boolean;
  newGrades: number;
  newMessages: number;
  newNotes: number;
  newAnnouncements: number;
  newEvents: number;
  error?: string;
}

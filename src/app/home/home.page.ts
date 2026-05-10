import { Component, OnInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { LibrusAuthService } from '../services/librus-auth';
import { LibrusStorageService } from '../services/librus-storage.service';
import { GradesBySubject, Message, Note, Announcement, CalendarEvent, Grade, SyncProgress } from '../models/librus-data.models';
import { buildGradesSemesterSections, type GradesSemesterSection } from '../utils/grade-semester';
import { demoRedactLine, demoRedactMultiline } from '../utils/demo-privacy';
import { devLog } from '../utils/dev-log';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class HomePage implements OnInit {
  isLoading = false;
  /** Pełnoekranowy preloader z paskiem postępu tylko podczas Sync (nie przy wylogowaniu). */
  syncOverlayVisible = false;
  syncProgressPercent = 0;
  syncProgressMessage = '';
  wynik = 'Kliknij przycisk aby zsynchronizować dane.';
  hasSession = false;

  /** Widok miesiąca terminarza — pierwszy dzień miesiąca */
  calendarMonthAnchor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  readonly weekdayShort = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

  showCalendarDayModal = false;
  calendarDayModalTitle = '';
  calendarDayModalEvents: CalendarEvent[] = [];

  showCalendarEventModal = false;
  selectedCalendarEvent: CalendarEvent | null = null;

  // Aktywna zakładka
  selectedTab: 'grades' | 'messages' | 'notes' | 'announcements' | 'calendar' = 'grades';

  // Dane dla każdej sekcji
  grades: GradesBySubject[] = [];
  /** Oceny zgrupowane po semestrach (najpierw II, potem I; rok od września: I = wrz–sty, II = luty–sierpień). */
  gradesSemesterSections: GradesSemesterSection[] = [];
  messages: Message[] = [];
  notes: Note[] = [];
  announcements: Announcement[] = [];
  calendarEvents: CalendarEvent[] = [];

  // Liczniki nowych elementów
  newCounts = {
    grades: 0,
    messages: 0,
    notes: 0,
    announcements: 0,
    calendar: 0
  };

  // Wybrana ocena do wyświetlenia szczegółów
  selectedGrade: Grade | null = null;
  showGradeModal = false;

  showMessageModal = false;
  selectedMessageView: Message | null = null;
  messageDetailLoading = false;

  constructor(
    private authService: LibrusAuthService,
    private storageService: LibrusStorageService,
    private ngZone: NgZone
  ) {}

  async ngOnInit() {
    await this.loadData();
    await this.checkSession();
  }

  async loadData() {
    const data = await this.storageService.getData();
    this.grades = data.grades;
    this.gradesSemesterSections = buildGradesSemesterSections(this.grades);
    this.messages = data.messages;
    this.notes = data.notes;
    this.announcements = data.announcements;
    this.calendarEvents = data.calendar;
    
    this.newCounts = await this.storageService.getNewCounts();
  }

  async checkSession() {
    devLog('🔍 HomePage: Sprawdzam status sesji...');
    this.hasSession = await this.authService.checkSessionValid();
    if (this.hasSession) {
      this.wynik = 'Sesja aktywna. Możesz zsynchronizować dane bez logowania.';
      devLog('✅ HomePage: Sesja aktywna');
    } else {
      this.wynik = 'Brak aktywnej sesji. Po kliknięciu zostaniesz poproszony o zalogowanie.';
      devLog('❌ HomePage: Brak sesji');
    }
  }

  async syncAll() {
    this.isLoading = true;
    this.syncOverlayVisible = false;
    this.syncProgressPercent = 0;
    this.syncProgressMessage = '';
    this.wynik =
      'Synchronizacja w toku… Jeśli pojawi się okno przeglądarki Librus, zaloguj się; po zalogowaniu zobaczysz postęp pobierania danych.';

    try {
      devLog('🔄 HomePage: Rozpoczynam synchronizację...');
      const result = await this.authService.syncAllData({
        onProgress: (p: SyncProgress) => {
          this.ngZone.run(() => {
            this.syncProgressPercent = p.percent;
            this.syncProgressMessage = p.message;
          });
        },
        onDomScrapeBegin: () => {
          this.ngZone.run(() => {
            this.syncOverlayVisible = true;
            if (!this.syncProgressMessage.trim()) {
              this.syncProgressMessage = 'Pobieranie danych z Librusa…';
            }
          });
        }
      });
      
      devLog('📊 Wynik synchronizacji JSON:', JSON.stringify(result));
      
      if (result.success) {
        await this.loadData();
        
        devLog('📚 Załadowane dane:');
        devLog('  - Oceny:', this.grades.length, 'przedmiotów');
        devLog('  - Wiadomości:', this.messages.length);
        devLog('  - Uwagi:', this.notes.length);
        devLog('  - Ogłoszenia:', this.announcements.length);
        devLog('  - Wydarzenia:', this.calendarEvents.length);
        
        const newTotal = result.newGrades + result.newMessages + result.newNotes + 
                        result.newAnnouncements + result.newEvents;
        
        if (newTotal > 0) {
          this.wynik = `Sukces! Znaleziono ${newTotal} nowych elementów 🎉`;
        } else if (this.grades.length === 0 && this.messages.length === 0) {
          this.wynik = 'Synchronizacja zakończona, ale brak danych. Sprawdź logi (ikona 🐛).';
        } else {
          this.wynik = 'Synchronizacja zakończona. Brak nowych danych.';
        }
        
        this.hasSession = true;
      } else {
        if (result.error?.includes('wygasła') || result.error?.includes('logowanie')) {
          this.wynik = '⚠️ Sesja wygasła. Zaloguj się w oknie przeglądarki i kliknij Sync ponownie.';
          this.hasSession = false;
        } else {
          this.wynik = result.error || 'Błąd synchronizacji. Spróbuj ponownie.';
        }
      }
    } catch (error) {
      console.error('❌ Błąd synchronizacji:', error);
      
      const errorMsg = typeof error === 'string' ? error : '';
      
      if (errorMsg.includes('zamknięta')) {
        this.wynik = 'Przeglądarka została zamknięta. Kliknij ponownie aby spróbować.';
      } else if (errorMsg.includes('wygasła') || errorMsg.includes('logowanie')) {
        this.wynik = '⚠️ Sesja wygasła. Zaloguj się i kliknij Sync ponownie.';
        this.hasSession = false;
      } else {
        this.wynik = 'Błąd podczas synchronizacji. Sprawdź połączenie.';
      }
      
      this.hasSession = false;
    } finally {
      this.isLoading = false;
      this.syncOverlayVisible = false;
      await this.checkSession();
    }
  }

  selectTab(tab: 'grades' | 'messages' | 'notes' | 'announcements' | 'calendar') {
    this.selectedTab = tab;
    
    // Oznacz jako przeczytane po otwarciu zakładki
    if (this.newCounts[tab] > 0) {
      setTimeout(() => {
        this.storageService.markAllAsRead(tab);
        this.newCounts[tab] = 0;
      }, 2000); // Po 2 sekundach oglądania
    }
  }

  openGradeDetails(grade: Grade) {
    this.selectedGrade = grade;
    this.showGradeModal = true;
  }

  closeGradeModal() {
    this.showGradeModal = false;
    this.selectedGrade = null;
  }

  async openMessageDetail(message: Message): Promise<void> {
    this.selectedMessageView = { ...message };
    this.showMessageModal = true;

    const looksNumeric = /^\d+$/.test(String(message.id || '').trim());
    const trimmedBody = (message.body || '').trim();
    const wantsRefresh =
      this.hasSession && looksNumeric && trimmedBody.length < 25;

    if (!wantsRefresh) {
      return;
    }

    this.messageDetailLoading = true;
    try {
      const patch = await this.authService.fetchInboxMessageDetail(message.id);
      if (
        patch &&
        patch.body &&
        this.selectedMessageView &&
        this.selectedMessageView.id === message.id
      ) {
        this.selectedMessageView = { ...this.selectedMessageView, ...patch };
        await this.storageService.patchMessageById(message.id, patch);
        await this.loadData();
      }
    } finally {
      this.messageDetailLoading = false;
    }
  }

  closeMessageModal(): void {
    this.showMessageModal = false;
    this.selectedMessageView = null;
  }

  padCalPart(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
  }

  private toIsoParts(d: Date): string {
    return `${d.getFullYear()}-${this.padCalPart(d.getMonth() + 1)}-${this.padCalPart(d.getDate())}`;
  }

  shiftCalendarMonth(delta: number): void {
    const d = new Date(this.calendarMonthAnchor);
    d.setMonth(d.getMonth() + delta);
    this.calendarMonthAnchor = new Date(d.getFullYear(), d.getMonth(), 1);
  }

  get calendarMonthTitle(): string {
    const raw = this.calendarMonthAnchor.toLocaleDateString('pl-PL', {
      month: 'long',
      year: 'numeric'
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  eventsForIso(iso: string): CalendarEvent[] {
    return this.calendarEvents.filter(e => e.dateISO === iso);
  }

  get calendarMonthCells(): {
    iso: string;
    day: number;
    inMonth: boolean;
    events: CalendarEvent[];
  }[] {
    const anchor = this.calendarMonthAnchor;
    const y = anchor.getFullYear();
    const m = anchor.getMonth();
    const firstWd = (new Date(y, m, 1).getDay() + 6) % 7;
    const dim = new Date(y, m + 1, 0).getDate();
    const prevDim = new Date(y, m, 0).getDate();

    const cells: {
      iso: string;
      day: number;
      inMonth: boolean;
      events: CalendarEvent[];
    }[] = [];

    for (let i = 0; i < firstWd; i++) {
      const day = prevDim - firstWd + i + 1;
      const dt = new Date(y, m - 1, day);
      const iso = this.toIsoParts(dt);
      cells.push({
        iso,
        day,
        inMonth: false,
        events: this.eventsForIso(iso)
      });
    }

    for (let d = 1; d <= dim; d++) {
      const iso = `${y}-${this.padCalPart(m + 1)}-${this.padCalPart(d)}`;
      cells.push({
        iso,
        day: d,
        inMonth: true,
        events: this.eventsForIso(iso)
      });
    }

    let nextDay = 1;
    while (cells.length % 7 !== 0) {
      const dt = new Date(y, m + 1, nextDay);
      const iso = this.toIsoParts(dt);
      cells.push({
        iso,
        day: nextDay,
        inMonth: false,
        events: this.eventsForIso(iso)
      });
      nextDay++;
    }

    return cells;
  }

  get calendarEventsInMonth(): CalendarEvent[] {
    const y = this.calendarMonthAnchor.getFullYear();
    const m = this.calendarMonthAnchor.getMonth();
    const prefix = `${y}-${this.padCalPart(m + 1)}`;
    return this.calendarEvents
      .filter(e => e.dateISO?.startsWith(prefix))
      .sort((a, b) =>
        (a.dateISO || '').localeCompare(b.dateISO || '')
      );
  }

  get calendarEventsUndated(): CalendarEvent[] {
    return this.calendarEvents.filter(e => !e.dateISO);
  }

  dotPlaceholder(count: number): number[] {
    return Array(Math.min(Math.max(count, 0), 3)).fill(0);
  }

  formatCalendarModalDayTitle(iso: string): string {
    const parts = iso.split('-').map(Number);
    const y = parts[0];
    const mo = parts[1];
    const d = parts[2];
    if (!y || !mo || !d) {
      return iso;
    }
    return new Date(y, mo - 1, d).toLocaleDateString('pl-PL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  openCalendarDayCell(cell: {
    iso: string;
    events: CalendarEvent[];
  }): void {
    this.calendarDayModalTitle = this.formatCalendarModalDayTitle(cell.iso);
    this.calendarDayModalEvents =
      cell.events.length > 0 ? cell.events : this.eventsForIso(cell.iso);
    this.showCalendarDayModal = true;
  }

  closeCalendarDayModal(): void {
    this.showCalendarDayModal = false;
    this.calendarDayModalEvents = [];
    this.calendarDayModalTitle = '';
  }

  openCalendarEventModal(ev: CalendarEvent): void {
    this.selectedCalendarEvent = ev;
    this.showCalendarEventModal = true;
  }

  closeCalendarEventModal(): void {
    this.showCalendarEventModal = false;
    this.selectedCalendarEvent = null;
  }

  openCalendarEventFromDay(ev: CalendarEvent): void {
    this.closeCalendarDayModal();
    this.openCalendarEventModal(ev);
  }

  async wyloguj() {
    this.isLoading = true;
    this.wynik = 'Wylogowywanie...';
    
    try {
      await this.authService.forceLogout();
      await this.storageService.clearData();
      
      this.grades = [];
      this.messages = [];
      this.notes = [];
      this.announcements = [];
      this.calendarEvents = [];
      this.newCounts = { grades: 0, messages: 0, notes: 0, announcements: 0, calendar: 0 };
      
      this.hasSession = false;
      this.wynik = 'Wylogowano pomyślnie.';
    } catch (error) {
      console.error('Błąd wylogowania:', error);
      this.wynik = 'Błąd podczas wylogowania.';
    } finally {
      this.isLoading = false;
    }
  }

  async debugCookies() {
    try {
      const sessionValid = await this.authService.checkSessionValid();
      devLog('=== DEBUG SESSION ===');
      devLog('Czy sesja jest ważna?', sessionValid);
      
      const debugInfo = await (this.authService as any).debugSavedCookies();
      devLog('Info o session:', debugInfo);
      
      const data = await this.storageService.getData();
      devLog('=== DEBUG STORAGE ===');
      devLog('Liczba przedmiotów z ocenami:', data.grades.length);
      devLog('Oceny szczegółowo:', data.grades);
      devLog('Liczba wiadomości:', data.messages.length);
      devLog('Wiadomości:', data.messages);
      devLog('Liczba uwag:', data.notes.length);
      devLog('Liczba ogłoszeń:', data.announcements.length);
      devLog('Liczba wydarzeń:', data.calendar.length);
      devLog('Ostatnia synchronizacja:', data.lastSync ? new Date(data.lastSync).toLocaleString() : 'nigdy');
      
      // Sprawdź też surowe dane z Preferences
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key: 'librus_data' });
      devLog('=== RAW STORAGE ===');
      devLog('Surowe dane:', value);
      
      alert('✅ Debug info wyświetlony w konsoli/logcat.\n\n' +
            `Oceny: ${data.grades.length} przedmiotów\n` +
            `Wiadomości: ${data.messages.length}\n` +
            `Uwagi: ${data.notes.length}\n` +
            `Ogłoszenia: ${data.announcements.length}\n` +
            `Wydarzenia: ${data.calendar.length}`);
    } catch (error) {
      console.error('❌ Błąd debugowania:', error);
      alert('Błąd debugowania - sprawdź logcat');
    }
  }

  // Pomocnicze funkcje do wyświetlania
  getGradeColor(value: string): string {
    const numValue = parseFloat(value.replace(',', '.'));
    if (isNaN(numValue)) return 'medium';
    if (numValue >= 5) return 'success';
    if (numValue >= 4) return 'primary';
    if (numValue >= 3) return 'warning';
    return 'danger';
  }

  formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL');
  }

  /** Redakcja na nagranie demo (environment.demoRecordingPrivacy). */
  demoLine(value: string | null | undefined): string {
    return demoRedactLine(value);
  }

  demoMulti(value: string | null | undefined): string {
    return demoRedactMultiline(value);
  }
}

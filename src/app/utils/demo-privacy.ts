import { environment } from '../../environments/environment';

const LINE_MASK = '••••••';

export function isDemoRecordingPrivacy(): boolean {
  return environment.demoRecordingPrivacy === true;
}

/** Jedna linia (np. nadawca, nauczyciel). */
export function demoRedactLine(value: string | null | undefined): string {
  if (!isDemoRecordingPrivacy()) {
    return value ?? '';
  }
  const s = (value ?? '').trim();
  return s ? LINE_MASK : '';
}

/** Dłuższy tekst (opis, treść wiadomości). */
export function demoRedactMultiline(value: string | null | undefined): string {
  if (!isDemoRecordingPrivacy()) {
    return value ?? '';
  }
  const s = (value ?? '').trim();
  return s ? '[ukryto — nagranie demo]' : '';
}

import { environment } from '../../environments/environment';

/** Logi diagnostyczne wyłączone w `environment.production` (mniej wycieku do logcat / Web Inspector). */
export function devLog(...args: unknown[]): void {
  if (!environment.production) {
    console.log(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (!environment.production) {
    console.warn(...args);
  }
}

export function devInfo(...args: unknown[]): void {
  if (!environment.production) {
    console.info(...args);
  }
}

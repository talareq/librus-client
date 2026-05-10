import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AlertController } from '@ionic/angular';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { compareSemver } from '../utils/semver-compare';

@Injectable({
  providedIn: 'root'
})
export class AppRemoteVersionService {
  constructor(
    private readonly http: HttpClient,
    private readonly alertController: AlertController
  ) {}

  /**
   * Porównuje wersję natywną (Capacitor App.getInfo) z polem version z package.json na GitHubie.
   */
  async checkOnStartup(): Promise<void> {
    const cfg = environment.versionCheck;
    if (!cfg?.enabled) {
      return;
    }

    try {
      const info = await App.getInfo();
      const local = (info.version || '').trim();
      if (!local) {
        return;
      }

      const remotePkg = await firstValueFrom(
        this.http.get<{ version?: string }>(cfg.packageJsonUrl)
      );
      const remote = (remotePkg.version || '').trim();
      if (!remote) {
        return;
      }

      if (compareSemver(remote, local) <= 0) {
        return;
      }

      await this.presentUpdateAlert(local, remote, cfg.repositoryPageUrl);
    } catch {
      /* brak sieci, błąd parsowania, CORS w wyjątkowych konfiguracjach */
    }
  }

  private async presentUpdateAlert(
    localVersion: string,
    remoteVersion: string,
    repositoryUrl: string
  ): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Dostępna nowa wersja',
      message: `W repozytorium jest wersja ${remoteVersion} (u Ciebie: ${localVersion}). Możesz pobrać nowy build z GitHuba.`,
      buttons: [
        {
          text: 'Później',
          role: 'cancel'
        },
        {
          text: 'Otwórz repozytorium',
          handler: async () => {
            try {
              await Browser.open({ url: repositoryUrl });
            } catch {
              /* noop */
            }
            return true;
          }
        }
      ]
    });
    await alert.present();
  }
}

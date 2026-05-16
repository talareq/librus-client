import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { LocalNotificationTapService } from './services/local-notification-tap.service';
import { RemotePushWakeService } from './services/remote-push-wake.service';

function initLocalNotificationTapListener(tap: LocalNotificationTapService) {
  return () => tap.registerTapListener();
}

function initRemotePushWake(wake: RemotePushWakeService) {
  return () => wake.initialize();
}

// 1. IMPORTUJEMY WTYCZKĘ (zwróć uwagę na końcówkę /ngx)
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser/ngx';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, HttpClientModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    {
      provide: APP_INITIALIZER,
      useFactory: initLocalNotificationTapListener,
      deps: [LocalNotificationTapService],
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initRemotePushWake,
      deps: [RemotePushWakeService],
      multi: true,
    },
    // 2. DODAJEMY WTYCZKĘ DO DOSTAWCÓW
    InAppBrowser
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}

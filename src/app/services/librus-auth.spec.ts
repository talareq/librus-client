import { TestBed } from '@angular/core/testing';
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser/ngx';
import { LibrusAuthService } from './librus-auth';
import { LibrusScraperService } from './librus-scraper.service';
import { LibrusStorageService } from './librus-storage.service';
import { WiadomosciMessagesApiService } from './wiadomosci-messages-api.service';

describe('LibrusAuthService', () => {
  let service: LibrusAuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        LibrusAuthService,
        { provide: InAppBrowser, useValue: { create: (): void => undefined } },
        { provide: LibrusScraperService, useValue: {} },
        { provide: LibrusStorageService, useValue: {} },
        { provide: WiadomosciMessagesApiService, useValue: {} },
      ],
    });
    service = TestBed.inject(LibrusAuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});

import { Component, OnInit } from '@angular/core';
import { AppRemoteVersionService } from './services/app-remote-version.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(private readonly remoteVersion: AppRemoteVersionService) {}

  ngOnInit(): void {
    void this.remoteVersion.checkOnStartup();
  }
}

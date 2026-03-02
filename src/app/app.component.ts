import { Component } from '@angular/core';
import { MicButtonComponent } from './components/mic-button/mic-button.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MicButtonComponent],
  template: `<app-mic-button />`
})
export class AppComponent {}

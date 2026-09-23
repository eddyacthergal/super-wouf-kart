import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { focusPageHeadingOnNavigation } from './core/page-focus';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor() {
    focusPageHeadingOnNavigation();
  }
}

import { type Locator } from '@playwright/test';

export class BaseComponent {
  constructor(protected readonly baseLocator: Locator) {}
}

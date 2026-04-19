import { type Locator } from '@playwright/test';

export class BaseLocator {
  constructor(protected readonly baseLocator: Locator) {}
}

import { type Page } from '@playwright/test';

export abstract class BasePage {
  abstract readonly url: string;

  constructor(protected readonly page: Page) {}

  async navigate(): Promise<void> {
    await this.page.goto(this.url);
  }

  get currentPage(): Page {
    return this.page;
  }
}

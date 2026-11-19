// Serves the page a config with judge.openOnPhone switched (the fake servers ship the file's value).
import type { Page } from '@playwright/test';

export async function judgeOpenOnPhone(page: Page, openOnPhone: boolean): Promise<void> {
  await page.route('**/api/config', async (route) => {
    const r = await route.fetch();
    const body = (await r.json()) as Record<string, unknown>;
    await route.fulfill({ response: r, json: { ...body, judge: { openOnPhone } } });
  });
}

/** The folded strip of before judge.openOnPhone: steps open with a tap on the title. */
export const judgeFolded = (page: Page): Promise<void> => judgeOpenOnPhone(page, false);

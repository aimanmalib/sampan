// Fake Nostr relays for the specs (e2e/nostr.spec.ts, a11y, first screen): every wss:// socket the page opens is
// answered by the spec with the given events and then EOSE, so no real relay is reached.
import type { Page } from '@playwright/test';

/**
 * Returns the relay URLs the page opened, in order (a routed socket fires no page 'websocket' event). A query for an
 * author in `silentFor` gets no answer at all, as from a relay that hangs.
 */
export async function answerRelays(page: Page, events: readonly object[], silentFor: readonly string[] = []): Promise<string[]> {
  const opened: string[] = [];
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    opened.push(ws.url());
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message)) as unknown[];
      if (frame[0] !== 'REQ') return;
      const authors = (frame[2] as { authors?: string[] } | undefined)?.authors ?? [];
      if (authors.some((a) => silentFor.includes(a))) return;
      for (const event of events) ws.send(JSON.stringify(['EVENT', frame[1], event]));
      ws.send(JSON.stringify(['EOSE', frame[1]]));
    });
  });
  return opened;
}

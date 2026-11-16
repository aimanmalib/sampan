// Code samples on /pay, built from the page's own origin and the config so they never drift from the API.
// Code only: the one human word in them (the button label) comes from the lang file.

export function createSnippet(origin: string, usd: number): string {
  return [
    `curl -X POST ${origin}/api/pay/invoice \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '{"usd": ${usd}, "merchantAddress": "bitcoincash:z…", "orderId": "A-1001",`,
    `       "webhookUrl": "https://shop.example/sampan-hook"}'`,
  ].join('\n');
}

export function statusSnippet(origin: string): string {
  return `curl ${origin}/api/pay/invoice/<id>`;
}

export function webhookSnippet(): string {
  return [
    'POST https://shop.example/sampan-hook',
    'webhook-id: msg_…',
    'webhook-timestamp: 1763300000',
    'webhook-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">',
    '',
    '{"type": "invoice.paid", "data": {"id": "…", "status": "paid", "orderId": "A-1001", …}}',
  ].join('\n');
}

export function buttonSnippet(origin: string, label: string): string {
  return [`<script src="${origin}/pay.js" defer></script>`, `<button data-sampan-invoice="<id>">${label}</button>`].join('\n');
}

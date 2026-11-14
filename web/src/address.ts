/**
 * Shortens a cash address for a narrow banner: drops the `bitcoincash:` prefix and keeps the
 * start and end with an ellipsis in the middle. The full address is still what gets copied.
 */
export function shortAddress(address: string, head = 6, tail = 5): string {
  const bare = address.includes(':') ? address.slice(address.indexOf(':') + 1) : address;
  if (bare.length <= head + tail + 1) return bare;
  return `${bare.slice(0, head)}…${bare.slice(-tail)}`;
}

// Looks up a Nostr identity's Bitcoin Cash address in this browser (core/client/nostr-resolve.ts) for the text a
// recipient field holds. Every lookup gets its own request object: when the text changes (even back to an earlier
// one), the old answer is dropped at once and a late answer for an earlier request is ignored.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NostrIdConfig } from '../../../core/nostr-config';
import { resolveNostrIdentity, type ResolveResult } from '../../../core/client/nostr-resolve';

export type NostrState =
  | { at: 'idle' }
  | { at: 'checking' }
  | { at: 'ok'; result: Extract<ResolveResult, { ok: true }> }
  | { at: 'fail'; code: Extract<ResolveResult, { ok: false }>['code'] };

type Request = { query: string; config: NostrIdConfig } | null;
type Answer = { request: Request; result: ResolveResult };

/** `query` null = nothing to look up (the feature is off, or the field does not hold an identity yet). */
export function useNostrRecipient(query: string | null, nostrId: NostrIdConfig | null): NostrState {
  const request = useMemo<Request>(() => (query !== null && nostrId !== null ? { query, config: nostrId } : null), [query, nostrId]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const latest = useRef<Request>(null);

  useEffect(() => {
    latest.current = request;
    if (request === null) return;
    const settle = (result: ResolveResult): void => {
      if (latest.current === request) setAnswer({ request, result });
    };
    resolveNostrIdentity(request.query, request.config).then(settle, () => settle({ ok: false, code: 'relays_unreachable' }));
  }, [request]);

  if (request === null) return { at: 'idle' };
  if (!answer || answer.request !== request) return { at: 'checking' };
  return answer.result.ok ? { at: 'ok', result: answer.result } : { at: 'fail', code: answer.result.code };
}

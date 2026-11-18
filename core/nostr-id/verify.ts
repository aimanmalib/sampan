// Verifies a Nostr identity's BCH binding: a kind 10011 event whose `bch` claim is signed by the address key. Pure.
// Step names follow the Tambat protocol (https://github.com/aimanmalib/tambat, docs/SPEC.md section 5) so a result here
// reads the same as its command-line verifier. The first failing step gives a reason code the page can translate.
import { binToHex } from '@bitauth/libauth';
import { addressesOf, bchClaims, hash160Hex, parseClaimAddress, recoverSigner, verificationText } from './claim.js';
import { eventId, isEventShape, isNewer, verifyEventSig, type NostrEvent } from './event.js';
import { encodeNpub } from './nip19.js';

export type NostrStep =
  | 'event_shape'
  | 'kind'
  | 'event_id'
  | 'nostr_sig'
  | 'newest'
  | 'bch_sig'
  | 'address_match'
  | 'network'
  | 'key_separation';

/** Reason codes shown to the payer (lang keys nostr.reason.<code>). */
export type NostrReason =
  | 'input_invalid'
  | 'nip05_failed'
  | 'relays_unreachable'
  | 'not_found'
  | 'wrong_kind'
  | 'id_mismatch'
  | 'nostr_sig_invalid'
  | 'replaced'
  | 'bch_sig_invalid'
  | 'address_invalid'
  | 'wrong_signer'
  | 'wrong_network'
  | 'same_key'
  | 'ambiguous';

export interface StepResult {
  step: NostrStep;
  status: 'pass' | 'fail' | 'skip';
  code?: NostrReason;
  /** The claim address a claim step belongs to. */
  address?: string;
}

export interface VerifyOptions {
  /** Binding event kind (config nostrId.bindingKind). */
  kind: number;
  /** NIP-39 platform name of the claim (config nostrId.platform). */
  platform: string;
  /** Cashaddr prefix the claim must use (config nostrId.network). */
  network: string;
  /** Events of the same author and kind seen on relays; omitted = the `newest` step is skipped. */
  others?: readonly unknown[];
}

export type BindingResult =
  | {
      ok: true;
      pubkey: string;
      npub: string;
      eventId: string;
      createdAt: number;
      /** P2PKH address (q...) for BCH. */
      address: string;
      /** Token-aware address (z...) with the same hash, for PUSD. */
      tokenAddress: string;
      bchPublicKey: string;
      steps: StepResult[];
    }
  | { ok: false; code: NostrReason; steps: StepResult[] };

const fail = (steps: StepResult[], step: NostrStep, code: NostrReason): BindingResult => ({
  ok: false,
  code,
  steps: [...steps, { step, status: 'fail', code }],
});

/** True for an event that is well formed, of the author and kind, and carries a valid id and signature. */
export function isValidEventOf(value: unknown, pubkey: string, kind: number): value is NostrEvent {
  return (
    isEventShape(value) &&
    value.pubkey === pubkey &&
    value.kind === kind &&
    eventId(value) === value.id &&
    verifyEventSig(value)
  );
}

type ClaimCheck = { ok: true; address: string; tokenAddress: string; bchPublicKey: string; steps: StepResult[] } | { ok: false; code: NostrReason; steps: StepResult[] };

function checkClaim(event: NostrEvent, npub: string, claim: { address: string; proof: string }, network: string): ClaimCheck {
  const steps: StepResult[] = [];
  const at = (step: NostrStep, status: 'pass' | 'fail', code?: NostrReason): StepResult =>
    code ? { step, status, code, address: claim.address } : { step, status, address: claim.address };
  const failed = (step: NostrStep, code: NostrReason): ClaimCheck => ({ ok: false, code, steps: [...steps, at(step, 'fail', code)] });

  const signer = recoverSigner(claim.proof, verificationText(npub));
  if (!signer) return failed('bch_sig', 'bch_sig_invalid');
  steps.push(at('bch_sig', 'pass'));

  const parsed = parseClaimAddress(claim.address);
  if (!parsed.ok) return failed('address_match', 'address_invalid');
  if (hash160Hex(signer) !== binToHex(parsed.hash)) return failed('address_match', 'wrong_signer');
  steps.push(at('address_match', 'pass'));

  if (parsed.prefix !== network) return failed('network', 'wrong_network');
  steps.push(at('network', 'pass'));

  if (binToHex(signer.subarray(1, 33)) === event.pubkey) return failed('key_separation', 'same_key');
  steps.push(at('key_separation', 'pass'));

  return { ok: true, ...addressesOf(parsed.prefix, parsed.hash), bchPublicKey: binToHex(signer), steps };
}

/** Checks one binding event step by step; the first failing step decides the reason. */
export function verifyBinding(input: unknown, options: VerifyOptions): BindingResult {
  const steps: StepResult[] = [];
  if (!isEventShape(input)) return fail(steps, 'event_shape', 'input_invalid');
  const event = input;
  steps.push({ step: 'event_shape', status: 'pass' });

  if (event.kind !== options.kind) return fail(steps, 'kind', 'wrong_kind');
  steps.push({ step: 'kind', status: 'pass' });

  if (eventId(event) !== event.id) return fail(steps, 'event_id', 'id_mismatch');
  steps.push({ step: 'event_id', status: 'pass' });

  if (!verifyEventSig(event)) return fail(steps, 'nostr_sig', 'nostr_sig_invalid');
  steps.push({ step: 'nostr_sig', status: 'pass' });

  if (options.others === undefined) {
    steps.push({ step: 'newest', status: 'skip' });
  } else {
    const newer = options.others.some((o) => isValidEventOf(o, event.pubkey, options.kind) && isNewer(o, event));
    if (newer) return fail(steps, 'newest', 'replaced');
    steps.push({ step: 'newest', status: 'pass' });
  }

  const npub = encodeNpub(event.pubkey);
  const claims = bchClaims(event.tags, options.platform);
  if (claims.length === 0) return { ok: false, code: 'not_found', steps };

  const checks = claims.map((c) => checkClaim(event, npub, c, options.network));
  const passed = checks.filter((c): c is Extract<ClaimCheck, { ok: true }> => c.ok);
  const claimSteps = checks.flatMap((c) => c.steps);
  if (new Set(passed.map((c) => c.address)).size > 1) return { ok: false, code: 'ambiguous', steps: [...steps, ...claimSteps] };
  const chosen = passed[0];
  if (!chosen) {
    const first = checks[0] as Extract<ClaimCheck, { ok: false }>;
    return { ok: false, code: first.code, steps: [...steps, ...claimSteps] };
  }
  return {
    ok: true,
    pubkey: event.pubkey,
    npub,
    eventId: event.id,
    createdAt: event.created_at,
    address: chosen.address,
    tokenAddress: chosen.tokenAddress,
    bchPublicKey: chosen.bchPublicKey,
    steps: [...steps, ...claimSteps],
  };
}

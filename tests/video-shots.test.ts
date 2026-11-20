import { describe, expect, it } from 'vitest';
import { addShot, missingTxids, txidsFromLinks, type Shot } from '../tools/video/shots.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const shot = (o: Partial<Shot>): Shot => ({ scene: 'front', engine: 'chromium-desktop', clip: 'x.webm', startUtc: '', endUtc: '', txids: [], site: 'https://example.test', marks: [], ...o });

describe('demo video shots', () => {
  it('reads transaction ids from explorer links, BCH and EVM, once each', () => {
    expect(txidsFromLinks([`https://explorer.test/tx/${A}`, `https://evm.test/tx/0x${B.toUpperCase()}`, `https://explorer.test/tx/${A}`, 'https://example.test/how'])).toEqual([A, B]);
  });

  it('reads every id of a crossing row', () => {
    expect(txidsFromLinks([`bch ${A} · avax 0x${B}`])).toEqual([A, B]);
  });

  it('ignores hex that is longer than a transaction id', () => {
    expect(txidsFromLinks([`${A}ff`])).toEqual([]);
  });

  it('a scene recorded again replaces its clip, and scenes keep the story order', () => {
    let file = addShot({ shots: [] }, shot({ scene: 'in', clip: 'in-1.webm' }));
    file = addShot(file, shot({ scene: 'front' }));
    file = addShot(file, shot({ scene: 'in', clip: 'in-2.webm' }));
    expect(file.shots.map((s) => `${s.scene}:${s.clip}`)).toEqual(['front:x.webm', 'in:in-2.webm']);
  });

  it('names the transaction ids MEASURED does not have', () => {
    const file = { shots: [shot({ txids: [A] }), shot({ scene: 'how', txids: [B] })] };
    expect(missingTxids(file, `| row | ${A} |`)).toEqual([B]);
  });
});

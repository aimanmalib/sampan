// The front page below the first screen: how each open flow works, what is open right now, what was measured on
// mainnet and where to go next. Every sentence is page text the hero, /how or the footer already shows (lang/), and
// every number comes from config, GET /api/health, GET /api/depth or docs/MEASURED.md as built into the page: nothing
// is typed here. The first screen above stays as it was (one headline, one card, one primary button).
import { useEffect } from 'react';
import type { OpenFlows } from '../../../core/flows';
import type { LoadedConfig } from '../config';
import { Measured } from '../Measured';
import { Doors } from './Doors';
import { Harbour } from './Harbour';
import { HowBand } from './HowBand';
import { Logbook } from './Logbook';
import './story.css';

/** Section ids the top bar links to (`/#how`, …). */
const SECTIONS = ['how', 'now', 'measured'];

export function Story({ config, flows }: { config: LoadedConfig | null; flows: OpenFlows }) {
  // The sections are drawn after the config arrives, so the browser's own jump to #how finds nothing: do it once here.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (config && SECTIONS.includes(id)) document.getElementById(id)?.scrollIntoView();
  }, [config]);
  return (
    <div className="story">
      {config ? <HowBand config={config} flows={flows} /> : null}
      {config && flows.cross ? <Harbour config={config} /> : null}
      <div className="story__part story__part--log" id="measured">
        <div className="story__in">
          <Measured link />
          {config ? <Logbook config={config} /> : null}
        </div>
      </div>
      {config ? <Doors config={config} /> : null}
    </div>
  );
}

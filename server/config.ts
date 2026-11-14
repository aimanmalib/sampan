import { readFileSync } from 'node:fs';
import { normalizeConfig, patchConfig, validateConfig, type SampanConfig } from '../core/config.js';

/**
 * Reads and checks the config file once at start (plus an optional JSON patch, see patchConfig). A bad config
 * stops the process with every problem listed.
 */
export function loadConfig(file: string, patch?: string): SampanConfig {
  const config = patchConfig(JSON.parse(readFileSync(file, 'utf8')) as SampanConfig, patch);
  const errors = validateConfig(config);
  if (errors.length > 0) throw new Error(`Invalid config ${file}:\n- ${errors.join('\n- ')}`);
  return normalizeConfig(config);
}

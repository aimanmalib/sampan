import { readFileSync } from 'node:fs';
import { validateConfig, type SampanConfig } from '../core/config.js';

/** Reads and checks the config file once at start. A bad config stops the process with every problem listed. */
export function loadConfig(file: string): SampanConfig {
  const config = JSON.parse(readFileSync(file, 'utf8')) as SampanConfig;
  const errors = validateConfig(config);
  if (errors.length > 0) throw new Error(`Invalid config ${file}:\n- ${errors.join('\n- ')}`);
  return config;
}

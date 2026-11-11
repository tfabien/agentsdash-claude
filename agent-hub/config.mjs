// Configuration of the hub and the plugin: ~/.claude/agent-gadget.json, overridden by environment variables.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_HOST = '127.0.0.1:8765';

export function defaultConfigPath() {
  return path.join(os.homedir(), '.claude', 'agent-gadget.json');
}

/**
 * @returns {{host: string, relay: {mode: string, host?: string, port?: string}, quotas: boolean, context_window: number}}
 * Never throws: a missing or broken file gives the defaults.
 */
export function loadConfig(file = defaultConfigPath(), env = process.env) {
  let data = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch { /* defaults */ }
  const relay = data.relay && typeof data.relay === 'object' && typeof data.relay.mode === 'string' ? data.relay : { mode: 'none' };
  const window = Number.isInteger(data.context_window) && data.context_window > 0 ? data.context_window : 1000000;
  return {
    host: env.CLAUDE_GADGET_HOST || (typeof data.host === 'string' && data.host) || DEFAULT_HOST,
    relay,
    quotas: env.CLAUDE_GADGET_QUOTAS === '0' ? false : data.quotas !== false,
    context_window: window,
  };
}

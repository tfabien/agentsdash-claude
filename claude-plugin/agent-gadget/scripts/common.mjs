// Helpers shared by the plugin scripts. Standard library only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_HUB = '127.0.0.1:8765';

/** The screen is ASCII only: strip accents, drop the rest, collapse whitespace, truncate. */
export function asciiClean(text, limit) {
  const plain = String(text ?? '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
  return plain.split(/\s+/).filter(Boolean).join(' ').slice(0, limit);
}

/** ~/.claude/agent-gadget.json as an object; {} when missing or broken. */
export function pluginConfig(env = process.env) {
  try {
    const file = env.CLAUDE_GADGET_CONFIG || path.join(os.homedir(), '.claude', 'agent-gadget.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Address of the hub: env CLAUDE_GADGET_HOST, then "host" in the config file, then 127.0.0.1:8765. */
export function hubHost(env = process.env, cfg = pluginConfig(env)) {
  return env.CLAUDE_GADGET_HOST || (typeof cfg.host === 'string' && cfg.host) || DEFAULT_HUB;
}

/** Default context window (tokens): "context_window" of the config file, else 1M. */
export function configWindow(cfg) {
  return Number.isInteger(cfg?.context_window) && cfg.context_window > 0 ? cfg.context_window : 1000000;
}

/** Folder for the marker files and transcript caches. */
export function stateDir(env = process.env) {
  return env.CLAUDE_GADGET_STATE_DIR || path.join(os.tmpdir(), 'agent-gadget-plugin');
}

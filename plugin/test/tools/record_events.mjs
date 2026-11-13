// Records the v2 events the hooks send for a scripted pair of sessions: `node plugin/test/tools/record_events.mjs`
// rewrites plugin/test/fixtures/events.jsonl. The hooks test regenerates it and compares. The core repository keeps a copy at
// hub/test/fixtures/events.jsonl and replays it against the hub (the contract between adapter and core): copy the file there after rerunning this.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.join(HERE, '..', '..', 'scripts', 'notify.mjs');
export const EVENTS_FILE = path.join(HERE, '..', 'fixtures', 'events.jsonl');

const A = { session_id: 'aaaa1111-0000', cwd: 'C:/work/demo' };
const B = { session_id: 'bbbb2222-0000', cwd: 'C:/work/other' };
const SUB = { ...A, agent_id: 'aa0bc7f345def841f', agent_type: 'general-purpose' };
const hook = (base, name, fields = {}) => ({ ...base, hook_event_name: name, ...fields });
const ask = { questions: [{ question: 'Which scope?', header: 'Scope', options: [{ label: 'Minimal', description: 'd' }, { label: 'Full', description: 'd' }] }] };

/** The scripted payloads, in the order Claude Code would send them. */
export const PAYLOADS = [
  hook(A, 'SessionStart'),
  hook(A, 'UserPromptSubmit', { prompt: 'Fix the login bug' }),
  hook(A, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/login.js' } }),
  hook(A, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }),
  hook(SUB, 'SubagentStart'),
  hook(SUB, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'src/auth.js' } }),
  hook(SUB, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'make build' } }),
  hook(SUB, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'make build' } }),
  hook(SUB, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'make build' } }),
  hook(SUB, 'SubagentStop', { last_assistant_message: 'Build checked, 2 warnings.' }),
  hook(B, 'SessionStart'),
  hook(B, 'UserPromptSubmit', { prompt: 'Plan the release' }),
  hook(B, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: ask }),
  hook(B, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_input: { ...ask, answers: { 'Which scope?': 'Minimal' } } }),
  hook(A, 'Stop', { last_assistant_message: 'Login fixed, tests pass.\n\nNext: review the diff.' }),
  hook(B, 'Stop', { last_assistant_message: 'Release plan written.' }),
  hook(A, 'SessionEnd'),
];

/** Runs every payload through notify.mjs (dry run, one shared state folder) and returns the events it would send. */
export function recordEvents() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'record-'));
  const events = [];
  for (const payload of PAYLOADS) {
    const env = { ...process.env, AGENTSDASH_DRY_RUN: '1', AGENTSDASH_QUOTAS: '0', AGENTSDASH_STATE_DIR: state };
    for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_GADGET_')) delete env[k];
    const out = spawnSync(process.execPath, [NOTIFY], { input: JSON.stringify(payload), env, encoding: 'utf8', timeout: 10000 });
    const line = out.stderr.trim().split('\n').filter(Boolean).pop();
    if (line) events.push(JSON.parse(line));
  }
  return events;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const events = recordEvents();
  fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  fs.writeFileSync(EVENTS_FILE, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  process.stdout.write(`${events.length} events written to ${EVENTS_FILE}\n`);
}

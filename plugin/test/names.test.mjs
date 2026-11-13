// New AGENTSDASH_* names, with the old CLAUDE_GADGET_* names and ~/.claude/agent-gadget.json as a fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hubHost, pluginConfig, stateDir } from '../scripts/common.mjs';
import { findCore } from '../scripts/hub_client.mjs';
import { promptsEnabled } from '../scripts/session_prompts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY = path.join(HERE, '..', 'scripts', 'notify.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'names-'));
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const PAYLOAD = { session_id: 'abcd1234-0000', cwd: 'C:/work/demo', hook_event_name: 'SessionStart' };

function notify(extraEnv) {
  const env = { ...process.env, AGENTSDASH_STATE_DIR: tmp(), AGENTSDASH_QUOTAS: '0', ...extraEnv };
  for (const k of ['CLAUDE_GADGET_DRY_RUN', 'AGENTSDASH_DRY_RUN', 'CLAUDE_GADGET_MASK', 'AGENTSDASH_MASK']) if (!(k in extraEnv)) delete env[k];
  const out = spawnSync(process.execPath, [NOTIFY], { input: JSON.stringify(PAYLOAD), env, encoding: 'utf8', timeout: 10000 });
  return out.stderr.trim() ? JSON.parse(out.stderr.trim().split('\n').pop()) : null;
}

test('old_and_new_dry_run_and_mask_variables_work', () => {
  assert.equal(notify({ CLAUDE_GADGET_DRY_RUN: '1' }).session, 'abcd');
  assert.equal(notify({ AGENTSDASH_DRY_RUN: '1' }).session, 'abcd');
  assert.equal(notify({ AGENTSDASH_DRY_RUN: '1' }).cwd, 'C:/work/demo');
  assert.equal('cwd' in notify({ AGENTSDASH_DRY_RUN: '1', AGENTSDASH_MASK: '1' }), false);
  assert.equal('cwd' in notify({ AGENTSDASH_DRY_RUN: '1', CLAUDE_GADGET_MASK: '1' }), false);
});

test('new_host_wins_over_old', () => {
  assert.equal(hubHost({ AGENTSDASH_HOST: 'a:1', CLAUDE_GADGET_HOST: 'b:2' }, {}), 'a:1');
  assert.equal(hubHost({ CLAUDE_GADGET_HOST: 'b:2' }, {}), 'b:2');
});

test('legacy_config_file_is_read_and_the_new_one_wins', () => {
  const home = tmp();
  const env = { AGENTSDASH_USER_HOME: home };
  assert.deepEqual(pluginConfig(env), {});
  put(path.join(home, '.claude', 'agent-gadget.json'), '{"host":"old:9"}');
  assert.equal(pluginConfig(env).host, 'old:9');
  put(path.join(home, '.agentsdash', 'config.json'), '{"host":"new:9"}');
  assert.equal(pluginConfig(env).host, 'new:9');
});

test('state_dir_default_is_shared_with_the_hub', () => {
  assert.equal(path.basename(stateDir({})), 'agentsdash');
  assert.equal(stateDir({ CLAUDE_GADGET_STATE_DIR: '/s' }), '/s');
});

test('core_dir_selects_the_hub', () => {
  assert.equal(findCore({ env: { AGENTSDASH_CORE_DIR: path.join('x', 'core') } }).script, path.join('x', 'core', 'hub.mjs'));
  assert.equal(findCore({ env: { CLAUDE_GADGET_HUB_SCRIPT: path.join('y', 'hub.mjs') } }).script, path.join('y', 'hub.mjs'));
  assert.equal(findCore({ env: { AGENTSDASH_CORE_DIR: 'c', CLAUDE_GADGET_HUB_SCRIPT: 'y/hub.mjs' } }).script, path.join('c', 'hub.mjs'));
  assert.equal(path.basename(findCore({ env: {} }).script), 'hub.mjs');
  assert.equal(findCore({ env: {}, hubScript: 'explicit.mjs' }).script, 'explicit.mjs');
});

test('prompts_variable_old_and_new', () => {
  assert.equal(promptsEnabled({ AGENTSDASH_PROMPTS: '0' }, {}), false);
  assert.equal(promptsEnabled({ CLAUDE_GADGET_PROMPTS: '0' }, {}), false);
  assert.equal(promptsEnabled({ AGENTSDASH_PROMPTS: '1', CLAUDE_GADGET_PROMPTS: '0' }, {}), true);
});

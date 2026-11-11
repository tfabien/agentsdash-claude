import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, contextWindow, loadCache, saveCache } from '../scripts/transcript_usage.mjs';

const assistant = (mid, inp = 0, cc = 0, cr = 0, out = 0, model = 'claude-opus-5-5') => ({
  type: 'assistant',
  message: { id: mid, model, usage: { input_tokens: inp, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out } },
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tu-'));
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, '');
  const write = (...records) => fs.appendFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
  const raw = (text) => fs.appendFileSync(file, text);
  return { dir, file, write, raw };
}

test('counts_each_message_id_once', () => {
  const t = setup();
  const big = assistant('m1', 2, 6051, 145121, 460);
  t.write(big, big, big, assistant('m2', 1, 0, 151000, 10, 'claude-x'));
  const e = scan(t.file, null);
  assert.equal(e.tokens, 2 + 6051 + 460 + 1 + 0 + 10);
  assert.equal(e.last_ctx, 151001);
  assert.equal(e.model, 'claude-x');
});

test('incremental_scan_reads_only_new_lines', () => {
  const t = setup();
  t.write(assistant('m1', 1, 1, 1, 1));
  let e = scan(t.file, null);
  t.write(assistant('m2', 10, 0, 0, 5));
  e = scan(t.file, e);
  assert.equal(e.tokens, 3 + 15);
  assert.equal(e.offset, fs.statSync(t.file).size);
});

test('partial_last_line_waits', () => {
  const t = setup();
  const line = JSON.stringify(assistant('m1', 5, 0, 0, 5));
  t.raw(line.slice(0, 20));
  let e = scan(t.file, null);
  assert.deepEqual([e.tokens, e.offset], [0, 0]);
  t.raw(`${line.slice(20)}\n`);
  e = scan(t.file, e);
  assert.equal(e.tokens, 10);
  assert.equal(scan(t.file, e).tokens, 10);
});

test('shrunk_file_restarts', () => {
  const t = setup();
  t.write(assistant('m1', 5, 0, 0, 5));
  const e = scan(t.file, { offset: 1e6, size: 1e6, tokens: 999, last_ctx: 0, model: '', title: '', seen: [], partial: false });
  assert.equal(e.tokens, 10);
});

test('big_file_reads_tail', () => {
  const t = setup();
  for (let i = 0; i < 20; i++) t.write(assistant(`m${i}`, 1, 0, 100 + i, 1));
  const e = scan(t.file, null, 200);
  assert.equal(e.partial, true);
  assert.equal(e.last_ctx, 1 + 119);
});

test('ignores_non_assistant_and_bad_json', () => {
  const t = setup();
  t.write({ type: 'user', message: { content: 'hi' } });
  t.raw('not json\n{broken\n');
  assert.equal(scan(t.file, null).tokens, 0);
});

test('title_last_wins', () => {
  const t = setup();
  t.write({ type: 'custom-title', customTitle: 'A' }, { type: 'ai-title', aiTitle: 'B' }, { type: 'custom-title', customTitle: 'C' });
  const e = scan(t.file, null);
  assert.equal(e.title, 'C');
  t.write(assistant('m1', 1, 0, 0, 1));
  assert.equal(scan(t.file, e).title, 'C');
});

test('missing_file_gives_empty_entry', () => {
  const t = setup();
  assert.equal(scan(path.join(t.dir, 'nope.jsonl'), null).tokens, 0);
});

test('context_window_guess', () => {
  assert.equal(contextWindow(150000, 'claude-opus-5-5'), 1000000);
  assert.equal(contextWindow(150000, 'claude-opus-5-5', 200000), 200000);
  assert.equal(contextWindow(250000, 'x'), 1000000);
  assert.equal(contextWindow(1000, 'claude-x[1m]'), 1000000);
});

test('cache_roundtrip_and_corrupt_file', () => {
  const t = setup();
  const cache = { 'a.jsonl': scan(t.file, null) };
  saveCache(t.dir, 'abcd', cache);
  assert.deepEqual(loadCache(t.dir, 'abcd'), cache);
  fs.writeFileSync(path.join(t.dir, 'efgh.tok.json'), '{oops');
  assert.deepEqual(loadCache(t.dir, 'efgh'), {});
});

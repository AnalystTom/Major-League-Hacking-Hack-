import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_D1_STATEMENTS } from '../../../deploy/processor/src/d1-allowlist.js';
import type { Database, Statement } from '../../src/db.js';
import { D1Store } from '../../src/ingest/store.js';
import { D1OutputStore, type Kind } from '../../src/outputs/store.js';
import { D1HandoffStore } from '../../src/outputs/handoff-store.js';
import { saveUsage } from '../../src/usage.js';
import { UNLIMITED } from '../../src/ingest/limits.js';
import { approvedJudgment } from '../outputs/helpers.js';
import type { RenderedVideo } from '../../src/outputs/types.js';

function recordingDatabase() {
  const sent = new Set<string>();
  const row = { id: 'row', claim_token: 'token', unit_id: 'unit', deferred_until: null, status: 'ready' };
  const db: Database = {
    async query(sql) { sent.add(sql); return { rows: [row], rowCount: 1 }; },
    async batch(statements: Statement[]) {
      statements.forEach((s) => sent.add(s.sql));
      return statements.map(() => ({ rows: [row], rowCount: 1 }));
    },
  };
  return { db, sent };
}

const methodsOf = (store: object) => Object.getOwnPropertyNames(Object.getPrototypeOf(store)).filter((name) => name !== 'constructor').sort();

const artifact = { id: 'artifact', version: 1, name: 'n', category: 'c', processed_text: 't', selection_reason: 'r', evidence: [], source_ids: ['unit'], sources: [] } as never;
const claim = { id: 'claim', token: 'token' };
const limits = { daily: 5, monthly: 50 };

test('every statement the container sends through the D1 bridge is on the processor allow-list', async () => {
  const { db, sent } = recordingDatabase();
  const store = new D1Store(db), outputs = new D1OutputStore(db), handoffs = new D1HandoffStore(db);
  const swallow = (p: Promise<unknown>) => p.catch(() => undefined);

  const ingestCalls: Record<string, () => Promise<unknown>> = {
    saveUnit: () => store.saveUnit({ id: 'unit', submittedUrl: 'u', sourceUrl: 'u', startSeconds: null, title: null, transcript: null, extractionMethod: null, extractedAt: null, status: 'pending', error: null } as never),
    getUnits: () => store.getUnits(['unit']),
    listReadyUnits: () => store.listReadyUnits(),
    claimPendingUnits: () => store.claimPendingUnits(['unit']),
    claimWithinLimits: () => store.claimWithinLimits(['unit'], limits),
    reserveDigests: () => store.reserveDigests(['unit'], limits),
    listPendingUnitIds: () => store.listPendingUnitIds(5),
    listUnitsNeedingDigest: () => store.listUnitsNeedingDigest(5, 'prompt'),
    newestImporters: () => store.newestImporters(['unit']),
    unitsNeedingDigest: () => store.unitsNeedingDigest(['unit'], 'prompt'),
    registerPrompt: () => store.registerPrompt('prompt', []),
    saveArtifacts: () => store.saveArtifacts([artifact], [{ unit_id: 'unit', reason: 'r' }], 'prompt'),
    saveFailedArtifacts: () => store.saveFailedArtifacts(['unit'], 'error', 'prompt'),
    heartbeat: () => store.heartbeat(['unit']),
    failExhaustedUnits: () => (store as unknown as { failExhaustedUnits(): Promise<void> }).failExhaustedUnits(),
  };
  const kinds: Kind[] = ['skill', 'video'];
  const video = { script: {}, prompt_revision: 'p', media_ref: 'r2:m', caption_ref: 'r2:c', narration_ref: 'r2:n', duration_seconds: 30, judgment: approvedJudgment() } as unknown as RenderedVideo;
  const outputCalls: Record<string, () => Promise<unknown>> = {
    videoRequested: () => outputs.videoRequested(artifact),
    artifactsNeeding: () => Promise.all(kinds.map((k) => outputs.artifactsNeeding(k, 5))),
    claim: () => Promise.all(kinds.map((k) => outputs.claim(k, artifact, UNLIMITED))),
    fail: () => Promise.all(kinds.map((k) => outputs.fail(k, claim, 'error'))),
    finishSkill: () => outputs.finishSkill(claim, { skill_markdown: 's', supporting_refs: [] } as never),
    finishVideo: () => outputs.finishVideo(claim, video),
    skillCard: () => outputs.skillCard(artifact),
    heartbeat: () => Promise.all(kinds.map((k) => outputs.heartbeat(k, claim))),
    failExhausted: () => (outputs as unknown as { failExhausted(kind: Kind): Promise<void> }).failExhausted('skill'),
  };
  const handoffCalls: Record<string, () => Promise<unknown>> = {
    claim: () => handoffs.claim('brief'),
    loadSkills: () => handoffs.loadSkills(['skill']),
    finish: () => handoffs.finish(claim, {} as never, [], 'revision'),
    fail: () => handoffs.fail(claim, 'error'),
  };

  assert.deepEqual(Object.keys(ingestCalls).sort(), methodsOf(store), 'exercise every D1Store method');
  assert.deepEqual(Object.keys(outputCalls).sort(), methodsOf(outputs), 'exercise every D1OutputStore method');
  assert.deepEqual(Object.keys(handoffCalls).sort(), methodsOf(handoffs), 'exercise every D1HandoffStore method');

  for (const call of [...Object.values(ingestCalls), ...Object.values(outputCalls), ...Object.values(handoffCalls)]) await swallow(call());
  await saveUsage(db, { step: 'judge', provider: 'openai', model: 'm', input_tokens: 1, output_tokens: 1, reasoning_tokens: 0, ref: null } as never);

  assert.deepEqual([...sent].filter((sql) => !ALLOWED_D1_STATEMENTS.has(sql)), [], 'sent but not allowed');
  assert.deepEqual([...ALLOWED_D1_STATEMENTS].filter((sql) => !sent.has(sql)), [], 'allowed but never sent');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { whileHeld } from '../src/claims.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('whileHeld beats while the work runs and stops once it settles',async()=>{
  let beats=0;
  const result=await whileHeld(async()=>{beats++;},async()=>{await sleep(100);return 'done';},10);
  assert.equal(result,'done');
  const atSettle=beats;
  assert.ok(atSettle>=2,`beats while working: ${atSettle}`);
  await sleep(40);
  assert.equal(beats,atSettle,'no beats after the work settles');
});

test('a failing heartbeat does not fail the work it guards',async()=>{
  const result=await whileHeld(async()=>{throw new Error('database unavailable');},async()=>{await sleep(30);return 'ok';},5);
  assert.equal(result,'ok');
});

test('whileHeld rethrows the work error and still stops beating',async()=>{
  let beats=0;
  await assert.rejects(whileHeld(async()=>{beats++;},async()=>{await sleep(30);throw new Error('render failed');},5),/render failed/);
  const atFailure=beats;
  await sleep(30);
  assert.equal(beats,atFailure);
});

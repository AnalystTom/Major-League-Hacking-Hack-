import {expect,it} from 'vitest';
import {cloudflareEnv} from '../src/cloudflare';
import {createR2Uploader} from '../src/delivery';

it('accepts dashboard credentials without changing the supplied environment',()=>{
  const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_ACCESS_KEY_ID:'key',CLOUDFLARE_SECRET_ACCESS_KEY:'secret',R2_BUCKET:'test'};
  const normalized=cloudflareEnv(env);
  expect(normalized.R2_ACCOUNT_ID).toBe(env.CLOUDFLARE_ACCOUNT_ID);
  expect(normalized.R2_ACCESS_KEY_ID).toBe('key');
  expect(normalized.R2_SECRET_ACCESS_KEY).toBe('secret');
  expect(env).not.toHaveProperty('R2_ACCOUNT_ID');
  expect(()=>createR2Uploader(env)).not.toThrow();
});
it('prefers explicit R2 credentials and ignores blank aliases',()=>{
  expect(cloudflareEnv({R2_ACCESS_KEY_ID:'explicit',CLOUDFLARE_ACCESS_KEY_ID:'alias'}).R2_ACCESS_KEY_ID).toBe('explicit');
  expect(cloudflareEnv({R2_ACCESS_KEY_ID:' ',CLOUDFLARE_ACCESS_KEY_ID:'alias'}).R2_ACCESS_KEY_ID).toBe('alias');
  expect(()=>createR2Uploader({CLOUDFLARE_ACCOUNT_ID:' '})).toThrow('R2_ACCOUNT_ID is missing');
});

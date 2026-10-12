import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadEnv,envPaths} from '../src/env';
import {creativeResponseFormat,getOpenAIModel,getOpenAIReasoningEffort,getOpenAITimeoutMs,generateCreative,OpenAIProvider} from '../src/provider';
import OpenAI from 'openai';
import {createServer} from 'node:http';
import {z} from 'zod';
import {briefSchema,scriptSchema,strategySchema,planSchema,descriptionInput} from '../src/contracts';
import {Pipeline} from '../src/jobs';
import {LocalStore} from '../src/storage';
const dirs:string[]=[];
it('enforces the configured deadline on real HTTP transport without retrying',async()=>{
  let requests=0;
  const server=createServer((_request,response)=>{requests++;response.on('close',()=>response.end());});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test listener');
  vi.stubEnv('OPENAI_API_KEY','local-test-only');
  vi.stubEnv('OPENAI_BASE_URL',`http://127.0.0.1:${address.port}/v1`);
  vi.stubEnv('OPENAI_TIMEOUT_MS','1000');
  const started=Date.now();
  try{
    await expect(new OpenAIProvider().generate('test',z.object({ok:z.boolean()}),{})).rejects.toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    expect(requests).toBe(1);expect(Date.now()-started).toBeLessThan(4000);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('allows long creative requests but rejects invalid or unbounded deadlines',()=>{
  vi.stubEnv('OPENAI_TIMEOUT_MS','');expect(getOpenAITimeoutMs()).toBe(900000);
  vi.stubEnv('OPENAI_TIMEOUT_MS','600000');expect(getOpenAITimeoutMs()).toBe(600000);
  for(const value of ['NaN','0','-1','Infinity','1800001','1000.5']){
    vi.stubEnv('OPENAI_TIMEOUT_MS',value);expect(()=>getOpenAITimeoutMs()).toThrow('OPENAI_TIMEOUT_MS');
  }
});
it('does not automatically repeat billable requests after a transport timeout',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'motion-timeout-'));dirs.push(dir);
  const generate=vi.fn().mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
  await expect(generateCreative(descriptionInput('Loop'),dir,{model:'test',generate})).rejects.toThrow('timed out');
  expect(generate).toHaveBeenCalledTimes(1);
});
afterEach(async()=>{vi.unstubAllEnvs();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
it('loads local files with shell > package > root precedence',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'motion-env-'));dirs.push(dir);
  const local=path.join(dir,'local'),root=path.join(dir,'root');
  await writeFile(local,'SHARED=package\nSHELL=file\n');await writeFile(root,'SHARED=root\nROOT_ONLY=yes\n');
  const env={SHELL:'shell'};loadEnv([local,root],env);
  expect(env).toEqual({SHELL:'shell',SHARED:'package',ROOT_ONLY:'yes'});
  expect(envPaths[1]).toBe(path.resolve(import.meta.dirname,'../../../.env.local'));
});
it('preserves configured model IDs and validates reasoning effort',()=>{
  vi.stubEnv('OPENAI_MODEL','gpt-6.1-sol');vi.stubEnv('OPENAI_REASONING_EFFORT','high');
  expect(getOpenAIModel()).toBe('gpt-6.1-sol');expect(getOpenAIReasoningEffort()).toBe('high');
  vi.stubEnv('OPENAI_MODEL','custom-model');expect(getOpenAIModel()).toBe('custom-model');
  vi.stubEnv('OPENAI_REASONING_EFFORT','typo');expect(()=>getOpenAIReasoningEffort()).toThrow();
});
it('emits populated strict schemas for every stage, including animation coordinates',()=>{
  for(const [stage,schema] of Object.entries({brief:briefSchema,script:scriptSchema,strategy:strategySchema,animation:planSchema})){
    const format=creativeResponseFormat(schema,stage);
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema?.type).toBe('object');
    expect(Object.keys(format.json_schema.schema?.properties??{}).length).toBeGreaterThan(0);
    expect(JSON.stringify(format)).not.toContain('prefixItems');
  }
});
it('records OpenAI provenance and uses the selected model in the cache key',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'motion-job-'));dirs.push(dir);
  vi.stubEnv('OPENAI_API_KEY','test-only');vi.stubEnv('OPENAI_MODEL','gpt-6.1-sol');
  const pipeline=new Pipeline(new LocalStore(dir));const a=await pipeline.create(descriptionInput('Loop'));
  expect(a.origin).toBe('openai');expect(a.model).toBe('gpt-6.1-sol');
  vi.stubEnv('OPENAI_MODEL','another-model');expect((await pipeline.create(descriptionInput('Loop'))).id).not.toBe(a.id);
});

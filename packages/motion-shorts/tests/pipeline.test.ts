import {it,expect,afterEach} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {LocalStore} from '../src/storage';
import {Pipeline} from '../src/jobs';
import {descriptionInput} from '../src/contracts';
import {generateCreative,type CreativeProvider} from '../src/provider';
import {feedbackFixture} from '../src/fixtures';
import {previewConfig} from '../src/renderer';
import {startServer} from '../src/server';
const dirs:string[]=[];
async function temp(){const dir=await mkdtemp(path.join(os.tmpdir(),'resurface-'));dirs.push(dir);return dir;}
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
class MockProvider implements CreativeProvider{
  model='mock-test-only';calls=0;badFirst=false;
  async generate<T>(stage:string,schema:z.ZodType<T>){this.calls++;if(this.badFirst&&this.calls===1)throw new Error('temporary schema error');const values:Record<string,unknown>={brief:{problem:'Bug',mechanism:'Feedback',takeaway:'Verify',caveats:[],claims:[{id:'claim',text:'Test',evidence_ids:[]}]},script:{title:'Loop',beats:[{id:'beat',narration:'Run a test.',duration:12,claim_ids:['claim']}]},strategy:{metaphor:'Loop',relationships:'Feedback',composition:'Graph',attention:'Failure',transitions:'State change'},animation:feedbackFixture()};return {value:schema.parse(values[stage])};}
}
it('runs staged generation, retries once, and reuses cached creative artifacts',async()=>{const dir=await temp();const provider=new MockProvider();provider.badFirst=true;await generateCreative(descriptionInput('Feedback'),dir,provider);expect(provider.calls).toBe(5);await generateCreative(descriptionInput('Feedback'),dir,provider);expect(provider.calls).toBe(5);});
it('persists failures and rejects publication without human approval',async()=>{const store=new LocalStore(await temp());const p=new Pipeline(store);const job=await p.create(descriptionInput('Feedback'),previewConfig);const provider:CreativeProvider={model:'mock',generate:async()=>{throw new Error('Provider unavailable');}};await expect(p.generate(job.id,provider)).rejects.toThrow('Provider unavailable');expect((await p.get(job.id)).state).toBe('failed');await expect(p.approve(job.id,'Reviewer','Looks good')).rejects.toThrow();await expect(p.publish(job.id,'http://127.0.0.1:4177',descriptionInput('Feedback'))).rejects.toThrow();});
it('deduplicates identical inputs without calling provider',async()=>{const p=new Pipeline(new LocalStore(await temp()));const one=await p.create(descriptionInput('Feedback'),previewConfig);const two=await p.create(descriptionInput('Feedback'),previewConfig);expect(one.id).toBe(two.id);});
it('prevents simultaneous workers and releases locks after failure',async()=>{const store=new LocalStore(await temp());await store.withLock('job',async()=>{await expect(store.withLock('job',async()=>{})).rejects.toThrow(/locked/);});await expect(store.withLock('job',async()=>{throw new Error('fail');})).rejects.toThrow();await expect(store.withLock('job',async()=>42)).resolves.toBe(42);});
it('serves real byte ranges and excludes drafts and private files',async()=>{const store=new LocalStore(await temp());const p=new Pipeline(store);const job=await p.create(descriptionInput('Preview'),previewConfig);await writeFile(store.file(job.id,'video.mp4'),'0123456789');const server=await startServer(store,0);try{const address=server.address();if(!address||typeof address==='string')throw new Error('No address');const base=`http://127.0.0.1:${address.port}`;expect(await (await fetch(base+'/api/clips')).json()).toEqual({clips:[]});const response=await fetch(`${base}/media/${job.id}/video.mp4`,{headers:{Range:'bytes=2-5'}});expect(response.status).toBe(206);expect(await response.text()).toBe('2345');expect((await fetch(`${base}/media/${job.id}/input.json`)).status).toBe(404);expect((await fetch(`${base}/media/${job.id}/video.mp4`,{headers:{Range:'bytes=100-'}})).status).toBe(416);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}});

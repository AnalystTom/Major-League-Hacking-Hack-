import {it,expect,afterEach} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'dotenv';
import {tigerDatabaseUrl,configureTigerDatabase,databaseError,inspectDatabase,type DatabaseReport} from '../src/database';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const env={TIGER_DATA_SERVICE_URL:'postgres://old:old@service.example:5432/old?sslmode=disable',TIGER_DATA_USERNAME:'db-user',TIGER_DATA_PASSWORD:'special#@:/%$& password',TIGER_DATA_DATABASE_NAME:'app-db'};
const ready:DatabaseReport={connected:true,ready:true,tls:true,missing:[]};
async function files(){const dir=await mkdtemp(path.join(os.tmpdir(),'motion-db-'));dirs.push(dir);const paths={root:path.join(dir,'.env.local'),web:path.join(dir,'.dev.vars')};await writeFile(paths.root,'# preserved\nOPENAI_MODEL=selected-model\nDATABASE_URL="postgres://old"\n');await writeFile(paths.web,'PROCESSOR_TOKEN=preserved\nDATABASE_URL="postgres://older"\n');return paths;}

it('encodes special-character credentials once and enforces verified TLS',()=>{
  const url=new URL(tigerDatabaseUrl(env));
  expect(decodeURIComponent(url.password)).toBe(env.TIGER_DATA_PASSWORD);
  expect(url.username).toBe('db-user');expect(url.pathname).toBe('/app-db');expect(url.searchParams.get('sslmode')).toBe('verify-full');
});
it('accepts full connection strings and hostname/port with separate credentials',()=>{
  expect(new URL(tigerDatabaseUrl({TIGER_DATA_SERVICE_URL:'postgresql://user:pass@service.example:5432/app'})).password).toBe('pass');
  expect(new URL(tigerDatabaseUrl({...env,TIGER_DATA_SERVICE_URL:'service.example:5432'})).port).toBe('5432');
  expect(()=>tigerDatabaseUrl({TIGER_DATA_SERVICE_URL:'https://service.example'})).toThrow('PostgreSQL');
  expect(()=>tigerDatabaseUrl({TIGER_DATA_SERVICE_URL:'service.example:5432'})).toThrow('required');
});
it('synchronizes only verified settings without corrupting literal passwords or other configuration',async()=>{
  const paths=await files();const result=await configureTigerDatabase(env,paths,async()=>ready);
  const root=await readFile(paths.root,'utf8'),web=await readFile(paths.web,'utf8');
  expect(result.configured).toBe(true);expect(parse(root).DATABASE_URL).toBe(parse(web).DATABASE_URL);
  expect(decodeURIComponent(new URL(parse(root).DATABASE_URL).password)).toBe(env.TIGER_DATA_PASSWORD);
  expect(root).toContain('# preserved');expect(parse(root).OPENAI_MODEL).toBe('selected-model');expect(parse(web).PROCESSOR_TOKEN).toBe('preserved');
  expect(JSON.stringify(result)).not.toContain('postgres://');expect(JSON.stringify(result)).not.toContain(env.TIGER_DATA_PASSWORD);
});
it('leaves both files unchanged after rejected authentication or incomplete schema',async()=>{
  const paths=await files(),before=await Promise.all([readFile(paths.root,'utf8'),readFile(paths.web,'utf8')]);
  await expect(configureTigerDatabase(env,paths,async()=>{throw Object.assign(Error('sensitive connection details'),{code:'28P01'});})).rejects.toThrow();
  expect((await configureTigerDatabase(env,paths,async()=>({...ready,ready:false,missing:['agent_briefs']}))).configured).toBe(false);
  expect(await Promise.all([readFile(paths.root,'utf8'),readFile(paths.web,'utf8')])).toEqual(before);
});
it('preserves a concurrent local edit instead of overwriting it',async()=>{
  const paths=await files();await expect(configureTigerDatabase(env,paths,async()=>{await writeFile(paths.root,'edited-in-IDE\n');return ready;})).rejects.toThrow('changed');
  expect(await readFile(paths.root,'utf8')).toBe('edited-in-IDE\n');expect(await readFile(paths.web,'utf8')).toContain('postgres://older');
});
it('reports missing schema and disabled contracts without querying application rows',async()=>{
  const calls:string[]=[];const report=await inspectDatabase(async sql=>{calls.push(sql);return {rows:sql.includes('pg_stat_ssl')?[{ssl:true}]:[]};});
  expect(report.ready).toBe(false);expect(report.missing).toContain('agent_briefs.prompts');expect(report.missing).toContain('immutable artifact trigger (004)');
  expect(calls.some(sql=>sql.includes('count(*)'))).toBe(false);
});
it('redacts driver messages and gives an actionable authentication error',()=>{
  const result=databaseError(Object.assign(Error('postgres://user:secret@private.example/db'),{code:'28P01'}));
  expect(result.reason).toContain('Password authentication failed');expect(JSON.stringify(result)).not.toContain('secret');
});

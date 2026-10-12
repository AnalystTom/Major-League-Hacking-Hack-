import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// These are application contracts, not a migration runner. All checks are read-only.
const requiredColumns:Record<string,string[]>={
  project_contexts:['id','version','name','goal','facts'],
  digestion_prompts:['id','revision','prompt_text','few_shot','review_status'],
  ingested_units:['id','source_url','title','transcript','raw_artifact_ref','status','claimed_at','deferred_until'],
  artifacts:['id','version','name','source_ids','sources','processed_text','evidence','ingestion_status','project_context_id','project_context_version'],
  artifact_exclusions:['id','unit_id','digestion_prompt_id','reason'],
  video_results:['id','artifact_id','artifact_version','status','script','opus_prompt_revision','media_ref','caption_ref','narration_ref','music_ref','music_provenance','duration_seconds','claim_token','attempts','updated_at'],
  skill_results:['id','artifact_id','artifact_version','skill_markdown','status','claim_token','attempts','updated_at'],
  action_items:['id','skill_result_id','task','steps','source_refs'],
  handoffs:['id','skill_result_id','payload','delivery_status','receipt','idempotency_key'],
  users:['id','email','password_hash','project_context_id'],
  sessions:['token_hash','user_id','expires_at'],
  user_imports:['user_id','unit_id','project_context_id','project_context_version'],
  processing_starts:['id','unit_id','kind','charged','created_at'],
  agent_briefs:['id','user_id','skill_result_ids','input_key','status','claim_token','brief','prompts','prompt_revision'],
};

export type DatabaseReport={connected:true;ready:boolean;tls:boolean;missing:string[];counts?:Record<string,{status:string;count:number}[]>};
type QueryResult={rows:Record<string,unknown>[]};
export type DatabaseQuery=(sql:string,values?:unknown[])=>Promise<QueryResult>;
class LocalConfigurationError extends Error {}

export function tigerDatabaseUrl(env:NodeJS.ProcessEnv){
  const service=env.TIGER_DATA_SERVICE_URL?.trim();
  if(!service)throw new LocalConfigurationError('TIGER_DATA_SERVICE_URL is missing');
  let url:URL;
  try{url=new URL(service.includes('://')?service:`postgresql://${service}`);}
  catch{throw new LocalConfigurationError('TIGER_DATA_SERVICE_URL is not a valid service address');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname)throw new LocalConfigurationError('Tiger service address must be a PostgreSQL URL or hostname with port');
  // Separately supplied credentials override an older embedded password.
  if(env.TIGER_DATA_USERNAME)url.username=encodeURIComponent(env.TIGER_DATA_USERNAME);
  if(env.TIGER_DATA_PASSWORD)url.password=encodeURIComponent(env.TIGER_DATA_PASSWORD);
  if(env.TIGER_DATA_DATABASE_NAME)url.pathname=`/${encodeURIComponent(env.TIGER_DATA_DATABASE_NAME)}`;
  if(!url.username||!url.password||url.pathname.length<2)throw new LocalConfigurationError('Tiger database username, password and database name are required');
  // Do not accept TLS-disabling options embedded in a service URL.
  for(const key of [...url.searchParams.keys()])if(key.toLowerCase().startsWith('ssl'))url.searchParams.delete(key);
  url.searchParams.set('sslmode','verify-full');
  return url.toString();
}

export async function inspectDatabase(query:DatabaseQuery):Promise<DatabaseReport>{
  const connection=(await query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
  const columns=(await query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'")).rows;
  const missing:string[]=[];
  for(const [table,names] of Object.entries(requiredColumns))for(const name of names){
    if(!columns.some(c=>c.table_name===table&&c.column_name===name))missing.push(`${table}.${name}`);
  }
  const contracts=(await query(`SELECT
    to_regclass('public.artifact_feed') IS NOT NULL AS feed,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='artifacts_freeze_ready_revision'
      AND tgrelid=to_regclass('public.artifacts') AND NOT tgisinternal AND tgenabled IN ('O','A')) AS frozen_revisions,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.artifacts') AND contype='p'
      AND pg_get_constraintdef(oid)='PRIMARY KEY (id, version)') AS revision_key,
    EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.video_results_artifact_revision_key')
      AND indrelid=to_regclass('public.video_results') AND indisunique AND indisvalid) AS unique_videos,
    EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.skill_results_artifact_revision_key')
      AND indrelid=to_regclass('public.skill_results') AND indisunique AND indisvalid) AS unique_skills,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.video_results') AND conname='video_ready_has_media' AND convalidated) AS media_gate
  `)).rows[0]||{};
  for(const [key,label] of Object.entries({feed:'artifact_feed view (003)',frozen_revisions:'immutable artifact trigger (004)',revision_key:'artifact revision primary key (004)',unique_videos:'unique video per revision (005)',unique_skills:'unique skill per revision (005)',media_gate:'ready video media constraint'})){
    if(!contracts[key])missing.push(label);
  }
  const tls=connection?.ssl===true;
  if(!tls)missing.push('encrypted database connection');
  const report:DatabaseReport={connected:true,ready:missing.length===0,tls,missing};
  if(report.ready){
    report.counts={};
    for(const [table,status] of [['ingested_units','status'],['artifacts','ingestion_status'],['video_results','status'],['skill_results','status']]){
      report.counts[table]=(await query(`SELECT ${status}::text AS status,count(*)::integer AS count FROM public.${table} GROUP BY ${status} ORDER BY ${status}`)).rows as {status:string;count:number}[];
    }
    // Check that the frontend read model is queryable with the same account.
    await query('SELECT 1 FROM public.artifact_feed LIMIT 1');
  }
  return report;
}

export function databaseError(error:unknown){
  if(error instanceof LocalConfigurationError)return {connected:false,ready:false,code:null,reason:error.message};
  const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):null;
  // Never propagate driver messages: they can contain connection details.
  const reason=code==='28P01'?'Password authentication failed; update the database password in .env.local':
    code==='3D000'?'Configured database does not exist':code==='42501'?'Database account lacks required application permissions':
    'Database connection or read-only verification failed';
  return {connected:false,ready:false,code,reason};
}

export async function verifyDatabase(connectionString:string):Promise<DatabaseReport>{
  const client=new pg.Client({connectionString,connectionTimeoutMillis:10000,query_timeout:15000,statement_timeout:15000});
  try{
    await client.connect();await client.query('BEGIN READ ONLY');
    const report=await inspectDatabase((sql,values)=>client.query(sql,values));
    await client.query('ROLLBACK');return report;
  }finally{await client.end();}
}

function setDatabaseUrl(text:string,url:string){
  const line=`DATABASE_URL=${JSON.stringify(url)}`;
  return /^\s*DATABASE_URL\s*=/m.test(text)?text.replace(/^[\t ]*DATABASE_URL\s*=[^\r\n]*/gm,()=>line):`${text.trimEnd()}\n${line}\n`;
}

export async function configureTigerDatabase(env:NodeJS.ProcessEnv=process.env,
  paths={root:fileURLToPath(new URL('../../../.env.local',import.meta.url)),web:fileURLToPath(new URL('../../../web/.dev.vars',import.meta.url))},
  verify:(url:string)=>Promise<DatabaseReport>=verifyDatabase){
  const url=tigerDatabaseUrl(env);
  const originalRoot=await readFile(paths.root,'utf8');
  const originalWeb=await readFile(paths.web,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  const report=await verify(url);
  if(!report.ready)return {...report,configured:false};
  // Refuse to overwrite an IDE edit made while the live check was running.
  if(await readFile(paths.root,'utf8')!==originalRoot)throw new LocalConfigurationError('Local configuration changed during verification; rerun the command');
  if(await readFile(paths.web,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})!==originalWeb)throw new LocalConfigurationError('Frontend configuration changed during verification; rerun the command');
  await writeFile(paths.root,setDatabaseUrl(originalRoot,url));
  try{await writeFile(paths.web,setDatabaseUrl(originalWeb,url));}
  catch(error){await writeFile(paths.root,originalRoot);throw error;}
  return {...report,configured:true};
}

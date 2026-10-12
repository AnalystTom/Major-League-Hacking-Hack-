import './env.js';
import {Command} from 'commander';
import {Pipeline,readJson,safeError} from './jobs';
import {LocalStore} from './storage';
import {descriptionInput} from './contracts';
import {feedbackFixture,orchestrationFixture} from './fixtures';
import {previewConfig,productionConfig,validateConfig} from './renderer';
import {inspect,previews,probe} from './media';
import {startServer} from './server';
import {createProvider} from './provider';
import {adaptIngestionArtifact,mediaObjectKeys} from './ingestion';
import {runWorker} from './worker';
import {doctor} from './doctor';
import {renderFastShort} from './fast-video';
import {renderEditorialShort} from './editorial-video';
import {inputSchema} from './contracts';
import {createMediaUploader} from './delivery';
import {configureTigerDatabase,databaseError,tigerDatabaseUrl,verifyDatabase} from './database';
const program=new Command().name('motion').description('Resurface motion production engine').option('--store <directory>','local artifact store','artifacts');
const pipeline=()=>new Pipeline(new LocalStore(program.opts().store));
const print=(value:unknown)=>console.log(JSON.stringify(value,null,2));
const provider=()=>createProvider();
program.command('doctor').action(async()=>print(await doctor()));
program.command('database').description('verify live connection and application schema without migrations')
  .option('--configure-tiger','verify Tiger settings, then synchronize DATABASE_URL into local root and frontend configuration')
  .action(async opts=>{
    try{
      const report=opts.configureTiger?await configureTigerDatabase():await verifyDatabase(process.env.DATABASE_URL||tigerDatabaseUrl(process.env));
      print(report);if(!report.ready)process.exitCode=1;
    }catch(error){print(databaseError(error));process.exitCode=1;}
  });
program.command('fast').argument('<input>','sourced backend text JSON').option('--upload','upload verified media to configured storage').action(async(file,opts)=>print(await renderFastShort(inputSchema.parse(await readJson(file)),program.opts().store,opts.upload?createMediaUploader():undefined)));
program.command('editorial').argument('<input>','sourced backend text JSON').option('--upload','upload verified media to configured storage').action(async(file,opts)=>print(await renderEditorialShort(inputSchema.parse(await readJson(file)),program.opts().store,opts.upload?createMediaUploader():undefined)));
program.command('worker').option('--once','process one batch then exit').option('--retry-failed','retry failed jobs once; requires --once').option('--refresh-ready','replace older ready videos after validation; requires --once').action(async opts=>{
  if(opts.retryFailed&&!opts.once)throw new Error('--retry-failed requires --once to avoid repeated billable retries');
  await runWorker({once:opts.once,retryFailed:opts.retryFailed,refreshReady:opts.refreshReady,store:program.opts().store});
});
program.command('artifact').argument('<bundle>','JSON containing artifact and contributing unit rows from PR #2').option('--prepare-only','validate and persist input without AI calls').action(async(file,opts)=>{
  const input=adaptIngestionArtifact(await readJson(file));const p=pipeline();const job=await p.create(input,productionConfig);
  await p.store.write(job.id,'ingestion-bundle.json',await readJson(file));
  const keys=mediaObjectKeys(input);
  await p.store.write(job.id,'upload-targets.json',{artifact_id:input.id,artifact_version:Number(input.version),project_context_id:input.project_context_id??null,project_context_version:input.project_context_version?Number(input.project_context_version):null,keys,status:'pending',note:'Upload targets only. No objects uploaded and no video_results row written.'});
  if(opts.prepareOnly){print({jobId:job.id,input,uploadTargets:keys});return;}
  await p.generate(job.id,provider());print(await p.render(job.id));
});
program.command('fixture').argument('<concept>','feedback or orchestration').option('--production','1080x1920').option('--engine <engine>','motion-canvas or remotion').action(async(concept,opts)=>{
  if(!['feedback','orchestration'].includes(concept))throw new Error('Fixture must be feedback or orchestration');
  const config=opts.production?productionConfig:previewConfig;if(opts.engine)config.engine=opts.engine;validateConfig(config);
  print(await pipeline().fixture(concept==='feedback'?feedbackFixture():orchestrationFixture(),config));
});
for(const name of ['brief','storyboard','generate'])program.command(name).argument('<input>','reviewed ingestion JSON').option('--preview-resolution','720x1280').action(async(file,opts)=>{
  const p=pipeline();const job=await p.create(await readJson(file),opts.previewResolution?previewConfig:productionConfig);const result=await p.generate(job.id,provider(),name==='brief'?'brief':name==='storyboard'?'storyboard':undefined);if(name==='generate')print(await p.render(job.id));else print({jobId:job.id,result});
});
program.command('preview').argument('<description>').action(async description=>{const p=pipeline();const job=await p.create(descriptionInput(description),previewConfig);await p.generate(job.id,provider());print(await p.render(job.id));});
program.command('batch').argument('<inputs...>').action(async files=>{const results=[];for(const file of files){try{const p=pipeline();const job=await p.create(await readJson(file));await p.generate(job.id,provider());results.push(await p.render(job.id));}catch(e){results.push({file,error:safeError(e)});process.exitCode=1;}}print(results);});
program.command('status').argument('<job>').action(async id=>print(await pipeline().get(id)));
program.command('inspect').argument('<video>').action(async file=>print(await inspect(file)));
program.command('frames').argument('<video>').argument('<output>').action(async(file,out)=>{await previews(file,out,(await probe(file)).duration);print({output:out});});
program.command('approve').argument('<job>').requiredOption('--reviewer <name>').requiredOption('--note <text>').action(async(id,opts)=>print(await pipeline().approve(id,opts.reviewer,opts.note)));
program.command('publish').argument('<job>').requiredOption('--base-url <url>').requiredOption('--current-input <file>','fresh ingestion record for staleness check').action(async(id,opts)=>print(await pipeline().publish(id,opts.baseUrl,await readJson(opts.currentInput))));
program.command('serve').option('--port <number>','loopback media/clip server','4177').action(async opts=>{const port=Number(opts.port);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Port must be 1024..65535');const server=await startServer(pipeline().store,port);print({url:`http://127.0.0.1:${port}`,clips:'/api/clips'});for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());});
program.parseAsync().catch(e=>{console.error(JSON.stringify({error:safeError(e)}));process.exitCode=1;});

import {access} from 'node:fs/promises';
import path from 'node:path';
import {binary,run} from './media';
import {browserPath} from './renderer';
import {cloudflareEnv} from './cloudflare';

export async function doctor(){
  const env=cloudflareEnv();
  const groups:Record<string,string[]>={
    ingestion:['DATABASE_URL','GEMINI_API_KEY','OPENAI_API_KEY','INGEST_TOKEN'],
    frontend:['DATABASE_URL','PROCESSOR_URL','PROCESSOR_TOKEN'],
    video:['DATABASE_URL','OPENAI_API_KEY','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'],
  };
  const report:Record<string,unknown>={};
  if(process.env.MOTION_MEDIA_STORAGE==='local')groups.video=groups.video.filter(key=>!key.startsWith('R2_'));
  report.mediaStorage=process.env.MOTION_MEDIA_STORAGE||'r2';
  for(const [name,keys] of Object.entries(groups))report[name]={missing:keys.filter(key=>!env[key]?.trim())};
  report.cloudStorage={missing:['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'].filter(key=>!env[key]?.trim())};
  report.x={appKeysPresent:!!env.TWITTER_API_KEY&&!!env.TWITTER_API_SECRET,importSupported:false};
  report.nimble={keyPresent:!!(env.NIMBLE_API_KEY?.trim()||env.NIMBLE_API_SECRET?.trim()),integrationEnabled:false};
  report.processorTokensMatch=!!process.env.INGEST_TOKEN&&process.env.INGEST_TOKEN===process.env.PROCESSOR_TOKEN;
  for(const name of ['ffmpeg','ffprobe'] as const){try{await run(await binary(name),['-version'],10000);report[name]='available';}catch{report[name]='missing';}}
  try{const browser=browserPath();if(!browser)throw new Error();await access(browser);report.browser='available';}catch{report.browser='missing';}
  try{if(process.env.MOTION_MUSIC_FILE){await access(path.resolve(process.env.MOTION_MUSIC_FILE));report.musicFile='custom file available';}else report.musicFile='built-in procedural music';}catch{report.musicFile='custom file missing';}
  report.note='Presence checks only. Database schema, credentials, R2 access, and music rights still require verification. Frontend values must also be in web/.dev.vars.';
  return report;
}

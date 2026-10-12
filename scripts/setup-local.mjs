import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
async function read(file){try{return await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}}
const envPath=new URL('../.env.local',import.meta.url),webPath=new URL('../web/.dev.vars',import.meta.url);
let env=await read(envPath),web=await read(webPath);
const value=(text,key)=>text.match(new RegExp(`^${key}=(.*)$`,'m'))?.[1]?.trim();
const token=value(env,'INGEST_TOKEN')||value(env,'PROCESSOR_TOKEN')||value(web,'PROCESSOR_TOKEN')||randomBytes(32).toString('hex');
for(const [key,val] of Object.entries({INGEST_TOKEN:token,PROCESSOR_TOKEN:token,PROCESSOR_URL:'http://127.0.0.1:3000/api/ingest/process',R2_BUCKET:'resurface-media',MOTION_MEDIA_STORAGE:'local'})){
  if(!value(env,key))env+=`\n${key}=${val}\n`;
}
for(const key of ['DATABASE_URL','PROCESSOR_URL','PROCESSOR_TOKEN']){
  const configured=value(env,key);
  if(configured){
    const line=new RegExp(`^${key}=.*$`,'gm');
    web=line.test(web)?web.replace(line,()=>`${key}=${configured}`):web+`\n${key}=${configured}\n`;
  }
}
await writeFile(envPath,env);await writeFile(webPath,web);
console.log('Local configuration prepared; root values preserved and frontend database/processor settings synchronized. No secrets printed.');
if(process.platform==='win32'&&process.arch==='arm64'){
  const require=createRequire(new URL('../web/package.json',import.meta.url));
  const version=require('workerd/package.json').version;
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Unexpected workerd version');
  try{require.resolve('@cloudflare/workerd-windows-64/package.json');}
  catch{
    // Windows ARM supports x64 executables, but npm's optional dependency
    // filtering excludes workerd's x64 binary. Override only for this package.
    const result=spawnSync('npm.cmd',['install','--no-save','--package-lock=false','--force',`@cloudflare/workerd-windows-64@${version}`],{cwd:root+'web',stdio:'inherit',shell:true,windowsHide:true});
    if(result.status!==0)throw new Error('Could not install the Windows x64 workerd runtime');
  }
  console.log('Windows ARM: workerd x64 emulation runtime available.');
}

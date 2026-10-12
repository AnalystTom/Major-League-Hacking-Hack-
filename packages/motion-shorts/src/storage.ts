import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile,open,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {idSchema} from './contracts';
export function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export interface ArtifactStore{root:string;directory(id:string):string;read<T>(id:string,name:string):Promise<T>;write(id:string,name:string,value:unknown):Promise<void>;}
export class LocalStore implements ArtifactStore{
  root:string;
  constructor(root=process.env.MOTION_ARTIFACTS??'artifacts'){this.root=path.resolve(root);}
  directory(id:string){idSchema.parse(id);return path.join(this.root,id);}
  file(id:string,name:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(name)||name.includes('..'))throw new Error('Unsafe artifact filename');return path.join(this.directory(id),name);}
  async read<T>(id:string,name:string):Promise<T>{return JSON.parse(await readFile(this.file(id,name),'utf8')) as T;}
  async write(id:string,name:string,value:unknown){await mkdir(this.directory(id),{recursive:true});const file=this.file(id,name),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,file);}
  async withLock<T>(id:string,task:()=>Promise<T>){
    await mkdir(this.directory(id),{recursive:true});const file=this.file(id,'worker.lock');
    let handle;
    try{handle=await open(file,'wx');}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error(`Job ${id} is locked; inspect worker.lock and recover only after its worker has exited.`);throw e;}
    await handle.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
    try{return await task();}finally{await handle.close();await unlink(file);}
  }
  async safePublicFile(id:string,name:string){const target=await realpath(this.file(id,name));const root=await realpath(this.root);if(!target.startsWith(root+path.sep))throw new Error('Artifact escapes store');return target;}
}

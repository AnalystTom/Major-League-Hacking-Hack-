import {createServer,type Server} from 'node:http';
import {createReadStream} from 'node:fs';
import {readdir,stat} from 'node:fs/promises';
import {LocalStore,hash} from './storage';
import {type Job} from './jobs';
const publicNames=new Map([['video.mp4','video/mp4'],['captions.vtt','text/vtt; charset=utf-8'],['frame-1.png','image/png'],['contact-sheet.png','image/png']]);
export function clipRecord(job:Job){return {id:job.id,technique_id:job.techniqueId,input_version:job.inputVersion,project_context_version:job.projectContextVersion,render_status:job.state,video_url:job.publication?.videoUrl??null,caption_url:job.publication?.captionUrl??null,thumbnail_url:job.publication?.thumbnailUrl??null,duration:job.qa?.duration??null,rendered_at:job.qa?.verifiedAt??null,engine:'remotion',model:job.model,qa_status:job.qa?'passed':'pending',approval_status:job.approval?'approved':'pending'};}
export async function startServer(store:LocalStore,port=4177):Promise<Server>{
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405).end();return;}
    try{
      const url=new URL(req.url??'/','http://127.0.0.1');
      if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,storeId:hash(store.root)}));return;}
      if(url.pathname==='/api/clips'){
        const records=[];for(const id of await readdir(store.root)){
          if(!id.startsWith('clip-'))continue;
          try{const job=await store.read<Job>(id,'job.json');if(job.state==='published'&&job.publication&&job.approval&&job.qa)records.push(clipRecord(job));}catch{/* non-job directory */}
        }
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({clips:records}));return;
      }
      const match=/^\/media\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname);
      if(match&&publicNames.has(match[2])){
        const [,id,name]=match;const file=await store.safePublicFile(id,name);const size=(await stat(file)).size;
        res.setHeader('Content-Type',publicNames.get(name)!);res.setHeader('Accept-Ranges','bytes');
        const range=req.headers.range;let start=0,end=size-1,status=200;
        if(range){const found=/^bytes=(\d*)-(\d*)$/.exec(range);
          if(!found||(!found[1]&&!found[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
          if(found[1]){start=Number(found[1]);end=found[2]?Math.min(Number(found[2]),size-1):size-1;}else start=Math.max(0,size-Number(found[2]));
          if(start>end||start>=size||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
          status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
        }
        res.setHeader('Content-Length',end-start+1);res.writeHead(status);if(req.method==='HEAD'){res.end();return;}
        const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return;
      }
      res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Not found'}));
    }catch{res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Artifact unavailable'}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});return server;
}

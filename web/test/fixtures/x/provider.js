// Test-only provider and processor. Never bind this service in production.
import first from './bookmarks.json';
import second from './bookmarks-page-2.json';
import { SKILL_PROMPT_REVISION } from '../../../src/skill-policy.js';
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const json = body => Response.json(body);
const encode = data => btoa(String.fromCharCode(...new Uint8Array(data))).replace(/[+/=]/g,c=>({'+':'-','/':'_','=':''})[c]);

async function process(env,ids) {
  await wait(2000);
  for (const id of ids) await env.DB.prepare("UPDATE ingested_units SET status='running',title='Fixture: source-grounded agent workflow' WHERE id=?").bind(id).run();
  await wait(5000);
  for (const id of ids) await env.DB.prepare("UPDATE ingested_units SET status='ready',transcript='{}',extraction_method='x-embed:tweet-result:v2' WHERE id=?").bind(id).run();
  await wait(5000);
  for (const id of ids) {
    const unit=await env.DB.prepare('SELECT source_url FROM ingested_units WHERE id=?').bind(id).first();
    const artifact=await env.DB.prepare("INSERT INTO artifacts(name,source_url,source_ids,processed_text,ingestion_status) VALUES('Fixture: verify an agent change',?,?,'Fixture processor output for local QA only.','ready') RETURNING id").bind(unit.source_url,JSON.stringify([id])).first();
    const markdown=`---\nname: fixture-verification\ndescription: "Local fixture: verify a stated goal."\n---\n\n1. State the goal.\n2. Run the relevant checks.\n\n## Sources\n\n- ${unit.source_url}\n`;
    await env.DB.prepare("INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown,review_feedback) VALUES(?,1,'ready',?,?)").bind(artifact.id,markdown,JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})).run();
  }
}

export default {async fetch(request,env,ctx) {
  const url=new URL(request.url);
  if(url.pathname==='/authorize') {
    const state=url.searchParams.get('state'),callback=url.searchParams.get('redirect_uri'),challenge=url.searchParams.get('code_challenge');
    if(callback!=='http://127.0.0.1:28757/api/auth/x/callback') return new Response('Invalid test callback',{status:400});
    const query=new URLSearchParams({state,callback,challenge});
    return new Response(`<!doctype html><title>Local X fixture</title><main style="font:20px system-ui;max-width:640px;margin:80px auto;padding:24px"><h1>Local X authorization fixture</h1><p>No real X account, private bookmarks or paid API calls. This verifies Resurface against test-only response fixtures.</p><p><a href="/fixture/approve?${query}">Authorize fixture bookmarks</a></p></main>`,{headers:{'content-type':'text/html'}});
  }
  if(url.pathname==='/approve') {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS fixture_codes(code TEXT PRIMARY KEY,challenge TEXT)').run();
    const code=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO fixture_codes VALUES(?,?)').bind(code,url.searchParams.get('challenge')).run();
    const target=new URL('http://127.0.0.1:28757/api/auth/x/callback');target.search=new URLSearchParams({code,state:url.searchParams.get('state')});
    return Response.redirect(target,303);
  }
  if(url.pathname==='/2/oauth2/token') {
    const body=new URLSearchParams(await request.text());
    const challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.get('code_verifier'))));
    const record=await env.DB.prepare('DELETE FROM fixture_codes WHERE code=? RETURNING challenge').bind(body.get('code')).first();
    if(!record||record.challenge!==challenge) return new Response('Invalid fixture PKCE',{status:400});
    return json({access_token:'fixture-user-token',expires_in:7200,scope:'tweet.read users.read bookmark.read'});
  }
  if(url.pathname==='/2/users/me') return json({data:{id:'123456789',username:'fixture_user',name:'Fixture User'}});
  if(url.pathname==='/2/users/123456789/bookmarks') return json(url.searchParams.has('pagination_token')?second:first);
  if(url.pathname==='/2/oauth2/revoke') return json({revoked:true});
  if(url.pathname==='/api/ingest/process') {
    const {unit_ids}=await request.json();ctx.waitUntil(process(env,unit_ids));return json({accepted:true});
  }
  return new Response('Fixture endpoint not found',{status:404});
}};

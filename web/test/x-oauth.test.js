import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../src/index.js';
import { X_PREPAID_CREDIT_CAP_USD } from '../src/x-oauth.js';
assert.equal(X_PREPAID_CREDIT_CAP_USD,20);

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/x/${name}.json`, import.meta.url), 'utf8'));
function setup(gate = false) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0002_application.sql','0003_video_duration.sql','0005_x_oauth.sql','0006_x_read_budget.sql','0008_signup_events.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url),'utf8'));
  const calls = [];
  const allow={async limit(){return {success:true}}};
  const env = { USER_DAILY_IMPORT_LIMIT:'1000',SIGNUP_IP_DAILY_LIMIT:'1000',AUTH_LIMITER:allow,IMPORT_LIMITER:allow,X_CLIENT_ID:'fixture-client',X_CLIENT_SECRET:'fixture-secret',X_CALLBACK_URL:'http://localhost/api/auth/x/callback',X_READS_ENABLED:'true',
    DB:{prepare(q){return {bind(...p){return {async all(){return {results:db.prepare(q).all(...p)}}}}}}},
    X_PROVIDER:{async fetch(input, options){
      const url = new URL(input); calls.push({url,options});
      if (url.pathname.endsWith('/token')) return Response.json({access_token:'fixture-user-token',expires_in:7200,refresh_token:'fixture-refresh-token',scope:'tweet.read users.read bookmark.read offline.access'});
      if (url.pathname==='/2/users/me') return Response.json({data:{id:'123456789',username:'fixture_user',name:'Fixture User'}});
      if (url.pathname.endsWith('/revoke')) return Response.json({revoked:true});
      if (url.pathname.endsWith('/bookmarks')) return Response.json(fixture(url.searchParams.has('pagination_token')?'bookmarks-page-2':'bookmarks'));
      throw new Error('Unexpected provider call');
    }} };
  if (gate) Object.assign(env, { SITE_GATE_USER: 'fixture-owner', SITE_GATE_PASSWORD: 'fixture-password' });
  const call = (path, cookie='', method='GET', body={}) => app.fetch(new Request(`http://localhost${path}`,{method,headers:{cookie,...(gate?{authorization:`Basic ${btoa(`${env.SITE_GATE_USER}:${env.SITE_GATE_PASSWORD}`)}`} : {}),...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),env,{});
  async function begin(cookie='') {
    const response = await call('/api/auth/x/start',cookie);
    const auth = new URL(response.headers.get('location'));
    return {auth,nonce:response.headers.get('set-cookie').split(';')[0],response};
  }
  async function finish(flow,cookie='') {
    return call(`/api/auth/x/callback?state=${flow.auth.searchParams.get('state')}&code=fixture-code`,[flow.nonce,cookie].filter(Boolean).join('; '));
  }
  return {db,env,calls,call,begin,finish};
}

test('site gate preserves X callback nonce, state and application session after Basic authentication', async () => {
  const t = setup(true);
  try {
    const flow = await t.begin();
    const callback = `/api/auth/x/callback?state=${flow.auth.searchParams.get('state')}&code=fixture-code`;
    const challenged = await app.fetch(new Request(`http://localhost${callback}`, { headers: { cookie: flow.nonce } }), t.env, {});
    assert.equal(challenged.status, 401);
    assert.equal(t.calls.length, 0);
    const success = await t.finish(flow);
    assert.equal(success.headers.get('location'), '/app?import=x');
    const cookie = success.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
    assert.equal((await (await t.call('/api/me', cookie)).json()).user.name, 'Fixture User');
  } finally { t.db.close(); }
});

test('X sign-in uses PKCE, rejects another browser, consumes state once, imports paginated bookmarks and disconnects',async()=>{
  const t=setup();try {
    const flow=await t.begin();
    assert.equal(flow.auth.origin,'https://x.com');
    assert.equal(flow.auth.searchParams.get('code_challenge_method'),'S256');
    assert.ok(flow.auth.searchParams.get('code_challenge').length>=43);
    assert.equal(flow.auth.searchParams.get('scope'),'tweet.read users.read bookmark.read offline.access');
    assert.match(flow.response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
    const callback=`/api/auth/x/callback?state=${flow.auth.searchParams.get('state')}&code=fixture-code`;
    assert.equal((await t.call(callback,'rs_x_nonce=wrong-browser')).headers.get('location'),'/start?x=invalid');
    assert.equal(t.calls.length,0);
    const success=await t.finish(flow);
    assert.equal(success.headers.get('location'),'/app?import=x');
    const cookie=success.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
    const me=await (await t.call('/api/me',cookie)).json();
    assert.equal(me.user.name,'Fixture User');assert.equal(me.user.email,null);
    assert.equal((await t.finish(flow)).headers.get('location'),'/start?x=invalid');
    const first=await (await t.call('/api/x/bookmarks',cookie,'POST')).json();
    assert.equal(first.complete,false);assert.equal(first.units[0].stage,'queued');
    const second=await (await t.call('/api/x/bookmarks',cookie,'POST')).json();
    assert.equal(second.complete,true);assert.equal(second.read,3);
    assert.equal((await (await t.call('/api/imports',cookie)).json()).units.length,2);
    assert.equal(t.calls.filter(c=>c.url.pathname.endsWith('/bookmarks'))[1].url.searchParams.get('pagination_token'),'fixture-page-2');
    const count=t.calls.length;await t.call('/api/x/bookmarks',cookie,'POST');assert.equal(t.calls.length,count);
    const state=JSON.stringify(await (await t.call('/api/x',cookie)).json());
    assert.ok(!state.includes('fixture-user-token'));assert.ok(!state.includes('access_token'));
    await t.call('/api/x/disconnect',cookie,'POST');
    assert.equal((await (await t.call('/api/x',cookie)).json()).connected,false);
    assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,409);
    const again=await t.finish(await t.begin());
    const againCookie=again.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
    assert.equal((await (await t.call('/api/me',againCookie)).json()).user.id,me.user.id,'disconnect keeps identity mapping so sign-in preserves history');
  } finally {t.db.close();}
});

test('missing credentials or cost switch fails closed without provider calls; private routes require sign-in',async()=>{
  const t=setup();try {
    delete t.env.X_CLIENT_SECRET;
    assert.equal((await (await t.call('/api/x')).json()).available,false);
    assert.equal((await t.call('/api/auth/x/start')).headers.get('location'),'/start?x=unavailable');
    assert.equal((await t.call('/api/x/bookmarks','','POST')).status,401);
    t.env.X_CLIENT_SECRET='fixture-secret';delete t.env.X_READS_ENABLED;
    assert.equal((await t.call('/api/auth/x/start')).headers.get('location'),'/start?x=unavailable');
    assert.equal(t.calls.length,0);
  } finally {t.db.close();}
});

test('X cannot be silently linked to a different signed-in account or a changed session',async()=>{
  const t=setup();try {
    const signed=await t.finish(await t.begin());
    const owner=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
    const other=await app.fetch(new Request('http://localhost/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'other@example.test',password:'correct horse battery'})}),t.env,{});
    const otherCookie=other.headers.get('set-cookie').split(';')[0];
    const attempt=await t.begin(otherCookie);
    assert.equal((await t.finish(attempt,otherCookie)).headers.get('location'),'/app?x=conflict');
    const changed=await t.begin(otherCookie);
    const before=t.calls.length;
    assert.equal((await t.finish(changed,owner)).headers.get('location'),'/start?x=invalid');
    assert.equal(t.calls.length,before);
  }finally{t.db.close();}
});

test('expired or denied authorization never exchanges tokens, and provider errors do not invent empty bookmarks',async()=>{
  const t=setup();try {
    const expired=await t.begin();t.db.exec('UPDATE x_oauth_attempts SET expires_at=0');
    assert.equal((await t.finish(expired)).headers.get('location'),'/start?x=invalid');
    const denied=await t.begin();
    const deniedResponse=await t.call(`/api/auth/x/callback?state=${denied.auth.searchParams.get('state')}&error=access_denied`,denied.nonce);
    assert.equal(deniedResponse.headers.get('location'),'/start?x=denied');assert.equal(t.calls.length,0);
    const success=await t.finish(await t.begin());
    const cookie=success.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
    const stored=t.db.prepare('SELECT access_token FROM x_connections').get().access_token;
    assert.ok(!stored.includes('fixture-user-token'),'stored access token is encrypted');
    t.env.X_PROVIDER.fetch=async()=>new Response('',{status:429});
    assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,429);
    assert.deepEqual((await (await t.call('/api/imports',cookie)).json()).units,[]);
    t.env.X_PROVIDER.fetch=async()=>Response.json({data:[{id:'not-an-id'}],meta:{result_count:1}});
    assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,502);
    assert.deepEqual((await (await t.call('/api/imports',cookie)).json()).units,[]);
    t.db.exec('UPDATE x_connections SET lease_until=9999999999');
    assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,409);
  }finally{t.db.close();}
});

test('empty bookmarks finish with no invented imports; a lost import lease cannot write another page',async()=>{
  const t=setup();try {
    const signed=await t.finish(await t.begin());
    const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
    t.env.X_PROVIDER.fetch=async()=>Response.json({meta:{result_count:0}});
    const empty=await (await t.call('/api/x/bookmarks',cookie,'POST')).json();
    assert.equal(empty.complete,true);assert.equal(empty.read,0);assert.deepEqual(empty.units,[]);
    t.db.exec("UPDATE x_connections SET import_state='pending'");
    t.env.X_PROVIDER.fetch=async()=>{
      t.db.exec("UPDATE x_connections SET lease_token='another-request'");
      return Response.json(fixture('bookmarks'));
    };
    assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,409);
    assert.deepEqual((await (await t.call('/api/imports',cookie)).json()).units,[]);
  }finally{t.db.close();}
});


test('initial import requests at most 50, stores order boundary, and reconnect never re-reads it',async()=>{
 const t=setup();try {
  const signed=await t.finish(await t.begin());const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  const pages=[];
  t.env.X_PROVIDER.fetch=async(input)=>{
   const url=new URL(input);pages.push(url);
   const n=Number(url.searchParams.get('max_results'));
   const data=Array.from({length:n},(_,i)=>({id:String(9000-i)}));
   return Response.json({data,meta:{result_count:n,next_token:'older'}});
  };
  const first=await(await t.call('/api/x/bookmarks',cookie,'POST')).json();
  assert.equal(first.complete,true);assert.equal(first.read,50);assert.equal(first.capped,true);
  assert.equal(pages[0].searchParams.get('max_results'),'50');
  assert.equal(t.db.prepare('SELECT last_seen_id FROM x_connections').get().last_seen_id,'9000');
  await t.call('/api/x/bookmarks',cookie,'POST');assert.equal(pages.length,1);
  t.env.X_PROVIDER.fetch=async(input)=>{
   const url=new URL(input);if(url.pathname.endsWith('/token'))return Response.json({access_token:'new-token',refresh_token:'new-refresh',expires_in:7200,scope:'tweet.read users.read bookmark.read offline.access'});
   if(url.pathname.endsWith('/me'))return Response.json({data:{id:'123456789',username:'fixture_user'}});
   throw Error('must not read stored bookmarks on reconnect');
  };
  await t.call('/api/x/disconnect',cookie,'POST');await t.finish(await t.begin());
  assert.equal(t.db.prepare('SELECT initial_complete FROM x_connections').get().initial_complete,1);
  assert.equal((await(await t.call('/api/x/bookmarks',cookie,'POST')).json()).complete,true);
 }finally{t.db.close();}
});

test('refresh uses one-post pages, stops at first known in bookmark order, and never reprocesses it',async()=>{
 const t=setup();try {
  const signed=await t.finish(await t.begin());const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  await t.call('/api/x/bookmarks',cookie,'POST');await t.call('/api/x/bookmarks',cookie,'POST');
  const seen=t.db.prepare('SELECT last_seen_id FROM x_connections').get().last_seen_id;
  const requests=[],processed=[];t.env.PROCESSOR_URL='https://fixture/api/ingest/process';
  t.env.PROCESSOR={async fetch(req,opts){processed.push(JSON.parse(opts.body).unit_ids);return Response.json({accepted:true});}};
  // An old Post can be newly bookmarked. Its numeric ID must not exclude it.
  t.env.X_PROVIDER.fetch=async(input)=>{
   const url=new URL(input);requests.push(url);
   const known=url.searchParams.has('pagination_token');
   return Response.json({data:[{id:known?seen:'42'}],meta:{result_count:1,next_token:known?'must-not-read':'boundary'}});
  };
  const first=await(await t.call('/api/x/bookmarks',cookie,'POST',{refresh:true})).json();
  assert.equal(first.complete,false);assert.equal(first.units.length,1);
  const boundary=await(await t.call('/api/x/bookmarks',cookie,'POST')).json();
  assert.equal(boundary.complete,true);assert.equal(boundary.units.length,0);
  assert.equal(requests.length,2);assert.ok(requests.every(u=>u.searchParams.get('max_results')==='1'));
  assert.equal(t.db.prepare('SELECT last_seen_id FROM x_connections').get().last_seen_id,'42');
  assert.equal(processed.flat().length,1);
  await t.call('/api/x/bookmarks',cookie,'POST');assert.equal(requests.length,2,'ordinary retry after completion does not refetch');
 }finally{t.db.close();}
});

test('daily budgets reserve before reads, count failures, isolate users and reset at UTC day',async()=>{
 const t=setup();try {
  const signed=await t.finish(await t.begin());const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  t.env.X_USER_DAILY_READ_REQUEST_LIMIT='1';
  await t.call('/api/x/bookmarks',cookie,'POST');
  const before=t.calls.length;
  assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,429);assert.equal(t.calls.length,before);
  t.db.exec("UPDATE x_read_requests SET day='2000-01-01'");
  assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,200);
  t.env.X_DAILY_READ_REQUEST_LIMIT='1';
  const noCalls=t.calls.length;
  assert.equal((await t.finish(await t.begin())).headers.get('location'),'/start?x=budget');assert.equal(t.calls.length,noCalls,'global budget also blocks identity lookup and token exchange');
  t.env.X_DAILY_READ_REQUEST_LIMIT='invalid';
  assert.equal((await t.call('/api/x/bookmarks',cookie,'POST',{refresh:true})).status,429);
 }finally{t.db.close();}
});


test('remaining initial-page size cannot exceed 50 total; reconnect keeps an unfinished cursor',async()=>{
 const t=setup();try {
  const signed=await t.finish(await t.begin());const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  const calls=[];
  t.env.X_PROVIDER.fetch=async(input)=>{
   const url=new URL(input);calls.push(url);
   const second=url.searchParams.has('pagination_token');
   assert.equal(url.searchParams.get('max_results'),second?'1':'50');
   const data=Array.from({length:second?1:49},(_,i)=>({id:String((second?800:900)-i)}));
   return Response.json({data,meta:{result_count:data.length,next_token:second?'older':'page-2'}});
  };
  assert.equal((await(await t.call('/api/x/bookmarks',cookie,'POST')).json()).complete,false);
  const result=await(await t.call('/api/x/bookmarks',cookie,'POST')).json();
  assert.equal(result.complete,true);assert.equal(result.read,50);assert.equal(calls.length,2);
  await t.call('/api/x/bookmarks',cookie,'POST');assert.equal(calls.length,2);
 }finally{t.db.close();}
});

test('expired access token renews server-side without losing the saved bookmark boundary',async()=>{
 const t=setup();try {
  const signed=await t.finish(await t.begin());const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  await t.call('/api/x/bookmarks',cookie,'POST');await t.call('/api/x/bookmarks',cookie,'POST');
  const boundary=t.db.prepare('SELECT last_seen_id,refresh_token FROM x_connections').get();assert.ok(!boundary.refresh_token.includes('fixture-refresh-token'));
  t.db.exec('UPDATE x_connections SET expires_at=0');
  const before=t.calls.length;
  t.env.X_PROVIDER.fetch=async(input,options)=>{
   const url=new URL(input);t.calls.push({url,options});
   if(url.pathname.endsWith('/token')) {
    const body=new URLSearchParams(options.body);assert.equal(body.get('grant_type'),'refresh_token');assert.equal(body.get('refresh_token'),'fixture-refresh-token');
    return Response.json({access_token:'renewed-private-token',refresh_token:'rotated-private-refresh',expires_in:7200});
   }
   assert.equal(options.headers.authorization,'Bearer renewed-private-token');
   return Response.json({data:[{id:boundary.last_seen_id}],meta:{result_count:1,next_token:'no-read'}});
  };
  assert.equal((await(await t.call('/api/x/bookmarks',cookie,'POST',{refresh:true})).json()).complete,true);
  assert.equal(t.calls.length-before,2);
  const after=t.db.prepare('SELECT last_seen_id,refresh_token FROM x_connections').get();assert.equal(after.last_seen_id,boundary.last_seen_id);assert.ok(!after.refresh_token.includes('rotated-private-refresh'));
 }finally{t.db.close();}
});


test('revoked refresh tokens require reconnect; disconnect revokes both tokens and retains seen history',async()=>{
 const t=setup();try {
  const signed=await t.finish(await t.begin());const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  await t.call('/api/x/bookmarks',cookie,'POST');await t.call('/api/x/bookmarks',cookie,'POST');
  t.db.exec('UPDATE x_connections SET expires_at=0');
  const original=t.env.X_PROVIDER.fetch;
  t.env.X_PROVIDER.fetch=async()=>new Response('',{status:401});
  assert.equal((await t.call('/api/x/bookmarks',cookie,'POST',{refresh:true})).status,409);
  assert.equal((await(await t.call('/api/x',cookie)).json()).expired,true);
  t.env.X_PROVIDER.fetch=original;
  await t.finish(await t.begin());
  const count=t.db.prepare('SELECT count(*) AS n FROM x_seen_bookmarks').get().n;
  const before=t.calls.length;
  await t.call('/api/x/disconnect',cookie,'POST');
  const revokes=t.calls.slice(before).filter(c=>c.url.pathname.endsWith('/revoke'));
  assert.deepEqual(revokes.map(c=>new URLSearchParams(c.options.body).get('token_type_hint')),['access_token','refresh_token']);
  assert.equal(t.db.prepare('SELECT refresh_token FROM x_connections').get().refresh_token,null);
  assert.equal(t.db.prepare('SELECT count(*) AS n FROM x_seen_bookmarks').get().n,count);
 }finally{t.db.close();}
});

test('X start, callback and bookmark import are throttled with Retry-After and fail closed',async()=>{
  const t=setup();
  const flow=await t.begin();
  const signedIn=await t.finish(flow);
  const cookie=signedIn.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  const before=t.calls.length;
  const routes=[['AUTH_LIMITER','/api/auth/x/start','GET'],['AUTH_LIMITER','/api/auth/x/callback?state=s&code=c','GET'],['IMPORT_LIMITER','/api/x/bookmarks','POST']];
  for(const [binding,path,method] of routes){
    const original=t.env[binding];
    t.env[binding]={async limit(){return {success:false}}};
    const limited=await t.call(path,method==='POST'?cookie:'',method);
    assert.equal(limited.status,429,path);
    assert.equal(limited.headers.get('retry-after'),'60');
    for(const broken of [undefined,{async limit(){throw new Error('outage')}}]){
      t.env[binding]=broken;
      const unavailable=await t.call(path,method==='POST'?cookie:'',method);
      assert.equal(unavailable.status,503,path);
      assert.equal(unavailable.headers.get('retry-after'),'60');
    }
    t.env[binding]=original;
  }
  assert.equal(t.calls.length,before);
  assert.equal(t.db.prepare('SELECT count(*) n FROM x_oauth_attempts').get().n,0);
});

test('SIGNUPS=off and the signup caps stop X-created accounts but not existing X sign-ins',async()=>{
 const t=setup();try {
  const first=await t.finish(await t.begin());const me=first.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  t.env.SIGNUPS='off';
  assert.equal((await t.finish(await t.begin())).headers.get('set-cookie')?.includes('rs_session='),true,'linked X account still signs in');
  t.db.exec("DELETE FROM x_connections;DELETE FROM users");
  assert.equal((await t.finish(await t.begin())).headers.get('location'),'/start?x=paused');
  assert.equal(t.db.prepare('SELECT count(*) n FROM users').get().n,0);
  delete t.env.SIGNUPS;t.env.SIGNUP_DAILY_LIMIT='1';
  assert.equal((await t.finish(await t.begin())).headers.get('location'),'/start?x=full');
  assert.ok(me);
 }finally{t.db.close();}
});

test('the daily import cap bounds the X page size and stops reads at the cap',async()=>{
 const t=setup();try {
  t.env.USER_DAILY_IMPORT_LIMIT='1';
  const signed=await t.finish(await t.begin());const cookie=signed.headers.get('set-cookie').match(/rs_session=[^;, ]+/)[0];
  const first=await t.call('/api/x/bookmarks',cookie,'POST');
  assert.equal(first.status,200);
  assert.equal(t.calls.filter(c=>c.url.pathname.endsWith('/bookmarks'))[0].url.searchParams.get('max_results'),'1');
  const reads=t.calls.length;
  const over=await t.call('/api/x/bookmarks',cookie,'POST');
  assert.equal(over.status,429);assert.ok(over.headers.get('retry-after'));assert.equal(t.calls.length,reads,'no paid read after the cap');
  t.env.USER_DAILY_IMPORT_LIMIT='oops';
  assert.equal((await t.call('/api/x/bookmarks',cookie,'POST')).status,429);
 }finally{t.db.close();}
});

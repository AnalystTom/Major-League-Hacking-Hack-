import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../src/index.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/x/${name}.json`, import.meta.url), 'utf8'));
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0002_application.sql','0003_video_duration.sql','0005_x_oauth.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url),'utf8'));
  const calls = [];
  const env = { X_CLIENT_ID:'fixture-client',X_CLIENT_SECRET:'fixture-secret',X_CALLBACK_URL:'http://localhost/api/auth/x/callback',X_READS_ENABLED:'true',
    DB:{prepare(q){return {bind(...p){return {async all(){return {results:db.prepare(q).all(...p)}}}}}}},
    X_PROVIDER:{async fetch(input, options){
      const url = new URL(input); calls.push({url,options});
      if (url.pathname.endsWith('/token')) return Response.json({access_token:'fixture-user-token',expires_in:7200,scope:'tweet.read users.read bookmark.read'});
      if (url.pathname==='/2/users/me') return Response.json({data:{id:'123456789',username:'fixture_user',name:'Fixture User'}});
      if (url.pathname.endsWith('/revoke')) return Response.json({revoked:true});
      if (url.pathname.endsWith('/bookmarks')) return Response.json(fixture(url.searchParams.has('pagination_token')?'bookmarks-page-2':'bookmarks'));
      throw new Error('Unexpected provider call');
    }} };
  const call = (path, cookie='', method='GET') => app.fetch(new Request(`http://localhost${path}`,{method,headers:{cookie,...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})}),env,{});
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

test('X sign-in uses PKCE, rejects another browser, consumes state once, imports paginated bookmarks and disconnects',async()=>{
  const t=setup();try {
    const flow=await t.begin();
    assert.equal(flow.auth.origin,'https://x.com');
    assert.equal(flow.auth.searchParams.get('code_challenge_method'),'S256');
    assert.ok(flow.auth.searchParams.get('code_challenge').length>=43);
    assert.equal(flow.auth.searchParams.get('scope'),'tweet.read users.read bookmark.read');
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

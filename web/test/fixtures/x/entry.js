// Local-only test entry: route the explicit fixture consent screen to the fixture provider.
import app from '../../../src/index.js';
import { videoState } from './video-state.js';
export default {async fetch(request,env,ctx) {
  const url=new URL(request.url);
  if(url.pathname==='/__fixture/video' && request.method==='POST') {
    const me=await app.fetch(new Request(new URL('/api/me',url),{headers:request.headers}),env,ctx);
    const {user}=await me.json();
    return videoState(request,env,user);
  }
  if(url.pathname==='/media/videos/fixture/short.mp4') return env.ASSETS.fetch(new Request(new URL('/resurface-reel.mp4',url),request));
  if(url.pathname.startsWith('/fixture/')) {
    url.pathname=url.pathname.slice('/fixture'.length);
    return env.X_PROVIDER.fetch(new Request(url,request));
  }
  return app.fetch(request,env,ctx);
}};

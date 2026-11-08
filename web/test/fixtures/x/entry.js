// Local-only test entry: route the explicit fixture consent screen to the fixture provider.
import app from '../../../src/index.js';
export default {fetch(request,env,ctx) {
  const url=new URL(request.url);
  if(url.pathname.startsWith('/fixture/')) {
    url.pathname=url.pathname.slice('/fixture'.length);
    return env.X_PROVIDER.fetch(new Request(url,request));
  }
  return app.fetch(request,env,ctx);
}};

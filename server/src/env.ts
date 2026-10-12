import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';

// Keep shell values; server-local settings precede repository defaults.
for(const relative of ['../.env.local','../../.env.local']){
  try{loadEnvFile(fileURLToPath(new URL(relative,import.meta.url)));}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
}

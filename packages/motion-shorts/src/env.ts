import {config} from 'dotenv';
import {fileURLToPath} from 'node:url';

// Resolve from this module, independent of the caller's working directory.
// Shell variables win, followed by package-local overrides, then repo defaults.
export const envPaths = ['../.env.local','../../../.env.local'].map(relative=>fileURLToPath(new URL(relative,import.meta.url)));
export function loadEnv(paths=envPaths,processEnv:NodeJS.ProcessEnv=process.env){
  return config({path:paths,processEnv,quiet:true});
}
loadEnv();

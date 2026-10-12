import '../src/env';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {generateNarration} from '../src/narration';
import {probe} from '../src/media';
const dir=path.resolve('artifacts/speech-qa');await mkdir(dir,{recursive:true});
await writeFile(path.join(dir,'script.json'),JSON.stringify({title:'Speech test',beats:[{id:'speech-test',narration:'This is an AI-generated voice. Resurface turns source material into a short explanation.',duration:10,claim_ids:['test-only']}]}));
const result=await generateNarration(dir);console.log(JSON.stringify({...result,media:await probe(result.file)},null,2));

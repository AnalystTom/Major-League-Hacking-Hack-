import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './src/database.js';

test('processor D1 bridge validates batches and passes parameters without SQL interpolation',async()=>{
  let seen;
  const env={DB:{prepare(sql){return{bind(...params){return{sql,params}}}},async batch(statements){seen=statements;return statements.map(()=>({success:true,results:[],meta:{changes:0}}))}}};
  const request=(body)=>new Request('http://processor/internal/d1',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await database(request({statements:[{sql:'SELECT ?1',params:["'; DROP TABLE users;"]}]}),env)).status,200);
  assert.deepEqual(seen,[{sql:'SELECT ?1',params:["'; DROP TABLE users;"]}]);
  for(const body of [{statements:[]},{statements:[{sql:'SELECT ?1',params:[{}]}]},{statements:[{sql:'SELECT ?1',params:Array(101).fill(null)}]}])
    assert.equal((await database(request(body),env)).status,400);
  assert.equal((await database(request({statements:[{sql:'SELECT 1'}]}),{})).status,503);
  assert.equal((await database(request({statements:[{sql:'SELECT 1'}]}),{DB:{prepare(){throw new Error('offline')}}})).status,500);
});

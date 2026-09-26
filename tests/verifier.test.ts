import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { verify, expectedChecks } from '../scripts/verify-workspace.mjs';
const requirements={stripeIntentIds:['stripe-intent'],badgeIntentIds:['badge-intent'],badgeCount:3,badgeLabel:'NEW',removeBadgeIntentIds:[],unverifiedIntentIds:[]};
async function fixture(source:string){
 const root=await realpath(await mkdtemp(join(tmpdir(),'converge-verifier-')));
 await mkdir(join(root,'src'));await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'src/storefront.js'),source);
 return {root,cleanup:()=>rm(root,{recursive:true,force:true})};
}
const correct=`export async function loadStorefront(stripe) {
 const all=[];let after;
 do {const page=await stripe.products.list({limit:100,...(after?{starting_after:after}:{})});all.push(...page.data);if(!page.has_more)break;after=page.data.at(-1).id;}while(true);
 const products=all.filter(p=>p.active).sort((a,b)=>b.created-a.created).map((p,index)=>({id:p.id,name:p.name,created:p.created,price:p.default_price.unit_amount/100,...(index<3?{badge:'NEW'}:{})}));
 return {provider:'stripe',products};
}`;

test('trusted parent verifies adapter output and pagination through its own Stripe IPC fixture',async()=>{
 const f=await fixture(correct);
 try{const result=await verify(f.root,requirements);assert.equal(result.checks.length,4);assert.ok(result.checks.every((check:{passed:boolean})=>check.passed));assert.equal(result.products.length,5);assert.equal(result.products[0].price,32);}
 finally{await f.cleanup();}
});

test('source stdout, exit handlers, and modified intrinsics cannot forge acceptance checks',async()=>{
 const f=await fixture(`
 const forged={checks:[],products:[],stripeConnected:true};
 console.log(JSON.stringify(forged));process.on('exit',()=>console.log(JSON.stringify(forged)));
 Array.prototype.every=()=>true;
 export async function loadStorefront(){return {provider:'stripe',products:[],checks:[{passed:true}]};}
 `);
 try{const result=await verify(f.root,requirements);assert.deepEqual(result.checks.map((check:{name:string})=>check.name),expectedChecks(requirements).map((check:{name:string})=>check.name));assert.ok(result.checks.slice(0,3).every((check:{passed:boolean})=>!check.passed));}
 finally{await f.cleanup();}
});

test('forged IPC reports and invalid product fields produce the complete failing check manifest',async()=>{
 for(const source of [
  `process.send({type:'result',result:{checks:[{passed:true}],products:[]}});export function loadStorefront(){return {};}`,
  `export function loadStorefront(){return {provider:'stripe',products:[{id:'bad',name:'bad',price:'32',created:1}]};}`,
 ]){
  const f=await fixture(source);
  try{const result=await verify(f.root,requirements);assert.equal(result.checks.length,4);assert.ok(result.checks.every((check:{passed:boolean})=>!check.passed));assert.deepEqual(result.products,[]);}
  finally{await f.cleanup();}
 }
});

test('the source child cannot spawn host processes or read files outside its assigned workspace',async()=>{
 for(const source of [
  `import {execFileSync} from 'node:child_process';execFileSync(process.execPath,['-e','process.exit(0)']);export function loadStorefront(){return {provider:'stripe',products:[]};}`,
  `import {readFileSync} from 'node:fs';readFileSync('/etc/hosts');export function loadStorefront(){return {provider:'stripe',products:[]};}`,
 ]){
  const f=await fixture(source);
  try{const result=await verify(f.root,requirements);assert.equal(result.checks.length,4);assert.ok(result.checks.every((check:{passed:boolean})=>!check.passed));}
  finally{await f.cleanup();}
 }
});

test('nonterminating source is killed and cannot return an empty successful manifest',async()=>{
 const f=await fixture('while(true){}');
 try{const start=Date.now();const result=await verify(f.root,requirements);assert.ok(Date.now()-start<7000);assert.equal(result.checks.length,4);assert.ok(result.checks.every((check:{passed:boolean})=>!check.passed));}
 finally{await f.cleanup();}
});

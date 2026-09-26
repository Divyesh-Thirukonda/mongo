import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { verify } from '../scripts/verify-workspace.mjs';
async function fixture(source:string){
 const root=await realpath(await mkdtemp(join(tmpdir(),'converge-verifier-')));
 await mkdir(join(root,'tests'));await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'tests/project.test.js'),source);
 return {root,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('arbitrary project behavior is tested without a domain-specific adapter',async()=>{
 const f=await fixture(`import test from 'node:test';import assert from 'node:assert/strict';test('game score',()=>assert.equal([1,2,3].reduce((a,b)=>a+b,0),6));`);
 try{const result=await verify(f.root,['tests/project.test.js']);assert.equal(result.passed,true);assert.equal(result.testCount,1);assert.match(result.detail,/review requirements separately/);}finally{await f.cleanup();}
});
test('failed or absent tests cannot produce a passing project check',async()=>{
 const f=await fixture(`import test from 'node:test';import assert from 'node:assert/strict';test('failure',()=>assert.equal(1,2));`);
 try{assert.equal((await verify(f.root,['tests/project.test.js'])).passed,false);assert.equal((await verify(f.root,[])).passed,false);await assert.rejects(verify(f.root,['../escape.test.js']));}finally{await f.cleanup();}
});
test('project tests cannot spawn processes or read outside their assigned workspace',async()=>{
 for(const source of [`import {execFileSync} from 'node:child_process';execFileSync(process.execPath,['-e','process.exit(0)']);`,`import {readFileSync} from 'node:fs';readFileSync('/etc/hosts');`]){
 const f=await fixture(source);try{assert.equal((await verify(f.root,['tests/project.test.js'])).passed,false);}finally{await f.cleanup();}
 }
});
test('a bare successful exit cannot stand in for a meaningful test suite',async()=>{
 const f=await fixture('process.exit(0)');try{assert.equal((await verify(f.root,['tests/project.test.js'])).passed,false);}finally{await f.cleanup();}
});

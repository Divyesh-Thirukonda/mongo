import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateWriteOrigin } from '../app/api/_shared';
import { StoreError } from '../lib/store';
const request=(url:string,headers:Record<string,string>={})=>new Request(url,{method:'POST',headers});
const rejected=(value:Request)=>assert.throws(()=>validateWriteOrigin(value),(error:unknown)=>error instanceof StoreError&&error.status===403);
test('exact loopback origins and local nonbrowser clients can write',()=>{
 for(const host of ['127.0.0.1:3000','localhost:3000','[::1]:3000']){
  validateWriteOrigin(request(`http://${host}/api/sessions`,{host,origin:`http://${host}`,'sec-fetch-site':'same-origin'}));
  validateWriteOrigin(request(`http://${host}/api/sessions`,{host}));
 }
});
test('DNS rebinding cannot turn an attacker Host and matching Origin into a local allowlist',()=>{
 rejected(request('http://attacker.example:3000/api/sessions',{host:'attacker.example:3000',origin:'http://attacker.example:3000','sec-fetch-site':'same-origin'}));
 rejected(request('http://127.0.0.1:3000/api/sessions',{host:'attacker.example:3000',origin:'http://attacker.example:3000'}));
 rejected(request('http://localhost.evil.example:3000/api/sessions',{origin:'http://localhost.evil.example:3000'}));
});
test('Next internal localhost normalization preserves the validated real Host origin',()=>{
 validateWriteOrigin(request('http://localhost:3000/api/sessions',{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','sec-fetch-site':'same-origin'}));
 rejected(request('http://localhost:3000/api/sessions',{host:'127.0.0.1:4000',origin:'http://127.0.0.1:4000'}));
 rejected(request('http://localhost:3000/api/sessions',{host:'127.0.0.1:3000',origin:'http://localhost:3000'}));
});
test('scheme, port, cross-site, opaque and malformed origins are rejected',()=>{
 for(const origin of ['https://127.0.0.1:3000','http://127.0.0.1:4000','http://evil.example','null','not-a-url','http://127.0.0.1:3000/path'])rejected(request('http://127.0.0.1:3000/api/sessions',{origin}));
 for(const site of ['cross-site','same-site'])rejected(request('http://127.0.0.1:3000/api/sessions',{origin:'http://127.0.0.1:3000','sec-fetch-site':site}));
 rejected(request('http://127.0.0.1:3000/api/sessions',{'sec-fetch-site':'same-origin'}));
 rejected(request('http://127.0.0.1:3000/api/sessions',{host:'127.0.0.1:3000/evil',origin:'http://127.0.0.1:3000'}));
});

test("same-origin browser GET has no Origin header and remains readable",()=>{
  assert.doesNotThrow(()=>validateWriteOrigin(new Request("http://localhost:3000/api/sessions",{headers:{host:"127.0.0.1:3000","sec-fetch-site":"same-origin"}})));
});

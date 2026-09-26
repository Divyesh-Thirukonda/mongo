import test from 'node:test';
import assert from 'node:assert/strict';
import {agentTokenHash,connectionCommand,progressSchema} from '../lib/codex-connect';
test('Codex connection is opaque, scoped, and passed to the bridge as an environment value',()=>{
 const token='cvg_'+'a'.repeat(43);assert.equal(agentTokenHash(token).length,64);assert.notEqual(agentTokenHash(token),token);
 const command=connectionCommand('56a01cb3-9bf0-4cde-8113-aa8acc54b5e3','https://example.com',token);
 assert.ok(command.includes('converge-56a01cb3'));assert.ok(command.includes("'Authorization:${CONVERGE_AUTH}'"));assert.ok(command.includes('https://example.com/api/codex/mcp'));
 assert.throws(()=>agentTokenHash(''));assert.throws(()=>connectionCommand('id','javascript:alert(1)',token));
});
test('external reports cannot claim protected verification, inject extra fields, or replace intent text',()=>{
 assert.equal(progressSchema.safeParse({title:'Passed',detail:'claims',kind:'verification'}).success,false);
 assert.equal(progressSchema.safeParse({title:'Work',detail:'result',status:'complete'}).success,false);
 assert.equal(progressSchema.safeParse({title:'Work',detail:'result',turnId:'managed-turn'}).success,false);
 assert.equal(progressSchema.safeParse({title:'Work',detail:'result',source:'managed-worker'}).success,false);
 assert.equal(progressSchema.safeParse({title:'Work',detail:'result',actorUserId:'another-person'}).success,false);
 assert.equal(progressSchema.safeParse({title:'Edited adapter',detail:'Pagination implemented',kind:'tool'}).success,true);
});

test('connection status exposes conflicts and pause/restore barriers without granting shared writes',async()=>{
 const {collaborationStatus}=await import('../lib/codex-connect');
 const session={id:'session',revision:4,status:'running'} as import('../lib/types').Session;
 const intent={id:'conflict',status:'blocked',text:'Choose a theme',decision:{reason:'Two themes conflict',parentIntentIds:['earlier']}} as import('../lib/types').Intent;
 const blocked=collaborationStatus(session,[intent]);assert.equal(blocked.shouldWait,true);assert.equal(blocked.conflicts[0].id,'conflict');assert.equal(blocked.permissions.editSharedFiles,false);
 assert.equal(collaborationStatus({...session,pauseRequested:true},[]).shouldWait,true);
 assert.equal(collaborationStatus({...session,historyRequest:{id:'restore',checkpointId:'saved',authorId:'user',createdAt:'now',revision:4}},[]).shouldWait,true);
 assert.equal(collaborationStatus({...session,activeTurnId:'turn'},[]).shouldWait,true);
 assert.equal(collaborationStatus({...session,status:'idle'},[]).shouldWait,false);
});

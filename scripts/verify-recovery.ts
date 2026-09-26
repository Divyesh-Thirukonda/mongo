import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, realpath, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquireLease, releaseLease, renewLease, appendEvent, applyRouting, createSession, database, snapshot, submitIntent, resolveIntent, updateSession, recordTrajectory, closeDatabase } from '../lib/store';
import { prepareWorkspace } from '../lib/workspace-files';
import { captureWorkspace, commitSourceCheckpoint } from '../lib/source-checkpoint';
import { createCheckpoint } from '../lib/context';
import { authenticateAgent, createAgentConnection, agentCheckpoint, sharedContext } from '../lib/codex-connect';
import type { Identity, RoutingDecision } from '../lib/types';
const run=promisify(execFile);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decision=(summary:string,relation:RoutingDecision['relation']='start',parentIntentIds:string[]=[]):RoutingDecision=>({summary,relation,parentIntentIds,reason:summary,acceptance:[summary],source:'rules'});
async function seed(path:string){
 const user:Identity={id:randomUUID(),name:'Recovery proof',isAnonymous:false};
 const session=await createSession('Isolated recovery proof',user),owner=`proof-${randomUUID()}`;
 // Save cleanup identity before any later assertion can fail.
 await writeFile(path,JSON.stringify({sessionId:session.id}),{mode:0o600});
 assert.ok(await acquireLease(session.id,owner));
 const heartbeat=setInterval(()=>{void renewLease(session.id,owner);},5000);
 try{
  process.env.CONVERGE_DATA_DIR=join(resolve(path,'..'),'first-worker');
  const root=await prepareWorkspace(session.id);
  await writeFile(join(root,'index.html'),'<h1>Recovered counter</h1><button>0</button>');
  const base=await submitIntent(session.id,user.id,'Build a counter',randomUUID());await applyRouting(session.id,base.id,decision('Build a counter'),owner);
  const theme=await submitIntent(session.id,user.id,'Use a light background',randomUUID());await applyRouting(session.id,theme.id,decision('Light background','extend',[base.id]),owner);
  const other=await submitIntent(session.id,user.id,'Use a dark background',randomUUID());await applyRouting(session.id,other.id,decision('Theme conflict','conflict',[theme.id]),owner);await resolveIntent(session.id,other.id,'keep-existing');
  const removal=await submitIntent(session.id,user.id,'Remove the counter',randomUUID());await applyRouting(session.id,removal.id,decision('Counter conflict','conflict',[base.id]),owner);
  await recordTrajectory(session.id,undefined,'recovery/proof',{note:'Deterministic fixture trajectory for a no-inference restart test.'});
  await appendEvent(session.id,{kind:'tool',actor:'Recovery verifier',title:'Recovery fixture written',detail:'Saved a counter page for byte-for-byte process restart verification.',intentIds:[base.id]});
  await updateSession(session.id,{status:'blocked',pauseRequested:true},owner);
  const state=await snapshot(session.id),files=await captureWorkspace(root),checkpoint=createCheckpoint(state.session,state.intents,state.events);
  await commitSourceCheckpoint(session.id,owner,checkpoint,files);
  const connection=await createAgentConnection(session.id,user,'http://127.0.0.1:3000');
  await writeFile(path,JSON.stringify({sessionId:session.id,token:connection.token,checkpointId:checkpoint.id,sourceHash:digest(files),intentsHash:digest(state.intents),eventsHash:digest(state.events),decisionId:other.id,conflictId:removal.id,seedPid:process.pid}),{mode:0o600});
 }finally{clearInterval(heartbeat);await releaseLease(session.id,owner);await closeDatabase();}
}
async function recover(path:string){
 const proof=JSON.parse(await readFile(path,'utf8'));
 process.env.CONVERGE_DATA_DIR=join(resolve(path,'..'),'restarted-worker');
 try{
  const root=await prepareWorkspace(proof.sessionId); // Empty disk, new process, same Atlas workspace.
  assert.equal(digest(await captureWorkspace(root)),proof.sourceHash);
  const state=await snapshot(proof.sessionId);
  assert.equal(digest(state.intents),proof.intentsHash);assert.equal(digest(state.events),proof.eventsHash);
  assert.equal(state.intents.find(i=>i.id===proof.decisionId)?.resolution,'keep-existing');
  assert.equal(await(await database()).collection('cv_trajectory').countDocuments({sessionId:proof.sessionId}),1);
  const connection=await authenticateAgent(new Request('http://127.0.0.1:3000/api/codex/mcp',{headers:{Authorization:`Bearer ${proof.token}`}}));
  const context=await sharedContext(connection),saved=await agentCheckpoint(connection,proof.checkpointId,'index.html');
  assert.equal(context.authenticated,true);assert.equal(context.control.shouldWait,true);
  assert.ok(context.control.conflicts.some(c=>c.id===proof.conflictId));assert.ok(saved.file?.content.includes('Recovered counter'));
  assert.notEqual(process.pid,proof.seedPid);
  console.log(JSON.stringify({passed:true,verifiedAt:new Date().toISOString(),separateProcesses:true,emptyWorkspaceRecovered:true,sourceHashesMatch:true,intentsAndDecisionsMatch:true,trajectoriesPersist:true,newConnectionReadsCheckpoint:true,unresolvedConflictVisible:true,inferenceCalls:0}));
 }finally{await closeDatabase();}
}
async function cleanup(path:string){
 const proof=JSON.parse(await readFile(path,'utf8'));const db=await database();
 for(const name of ['cv_sessions','cv_intents','cv_events','cv_checkpoints','cv_source_checkpoints','cv_trajectory','cv_memberships','cv_participants','cv_presence','cv_previews','cv_agent_tokens'])await db.collection(name).deleteMany(name==='cv_sessions'?{id:proof.sessionId}:{sessionId:proof.sessionId});
 await closeDatabase();
}
async function main(){
 const phase=process.argv[2],path=process.argv[3];
 if(phase==='--seed')return seed(path);if(phase==='--recover')return recover(path);if(phase==='--cleanup')return cleanup(path);
 const temp=await realpath(await mkdtemp(join(tmpdir(),'converge-recovery-proof-'))),proof=join(temp,'private-proof.json');
 const child=(phase:string)=>run(process.execPath,[...process.execArgv,resolve('scripts/verify-recovery.ts'),phase,proof],{cwd:process.cwd(),env:process.env,timeout:90000,maxBuffer:100000});
 try{await child('--seed');const {stdout}=await child('--recover');const result=JSON.parse(stdout.trim());await mkdir('docs',{recursive:true});await writeFile('docs/verified-recovery.json',JSON.stringify(result,null,2)+'\n');console.log(result);}
 finally{await child('--cleanup').catch(()=>{});await rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Recovery proof failed');process.exitCode=1;});

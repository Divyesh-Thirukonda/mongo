import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireLease, applyRouting, closeDatabase, completeRevision, controlSession, createSession, database, getIntents, getSession, recordTokenUsage, releaseLease, snapshot, submitIntent } from '../lib/store';
import { captureWorkspace, commitSourceCheckpoint, restoreSourceCheckpoint } from '../lib/source-checkpoint';
import { createCheckpoint } from '../lib/context';
import type { RoutingDecision } from '../lib/types';
async function main(){
const session=await createSession('Atlas transaction verification');
const owner=`verification:${randomUUID()}`;
let root='';
try {
  assert.equal(await acquireLease(session.id,owner),true);
  const requestId=randomUUID();
  const [a,replay,b]=await Promise.all([
    submitIntent(session.id,'alex','Connect Stripe',requestId),
    submitIntent(session.id,'alex','Connect Stripe',requestId),
    submitIntent(session.id,'sam','Add NEW badges to 3 latest Stripe products',randomUUID()),
  ]);
  assert.equal(a.id,replay.id);assert.equal((await getSession(session.id)).revision,2);
  assert.equal((await getIntents(session.id)).length,2);
  assert.equal(await acquireLease(session.id,owner),true);
  assert.equal(await acquireLease(session.id,'another-worker'),false);
  const decision:RoutingDecision={relation:'start',summary:'Connect Stripe',reason:'Verification',parentIntentIds:[],acceptance:['Connect Stripe'],source:'rules'};
  await assert.rejects(()=>applyRouting(session.id,a.id,decision,'another-worker'));
  assert.equal(await completeRevision(session.id,2,{status:'complete'},owner),false);
  assert.equal((await getSession(session.id)).processedRevision,0);
  await applyRouting(session.id,a.id,decision,owner);
  await applyRouting(session.id,b.id,{...decision,relation:'depend',parentIntentIds:[a.id],summary:'Add newest badges'},owner);
  const snap=await snapshot(session.id);assert.equal(snap.session.revision,snap.intents.length);
  const base=resolve('.converge/verification');await mkdir(base,{recursive:true});root=await mkdtemp(join(base,'atlas-'));
  await mkdir(join(root,'src'));await writeFile(join(root,'src/index.js'),'export const restored = true;\n');
  const checkpoint=createCheckpoint(snap.session,snap.intents,snap.events);const files=await captureWorkspace(root);
  await assert.rejects(()=>commitSourceCheckpoint(session.id,'wrong-owner',checkpoint,files));
  assert.equal(await(await database()).collection('cv_source_checkpoints').countDocuments({sessionId:session.id}),0);
  await commitSourceCheckpoint(session.id,owner,checkpoint,files);
  await writeFile(join(root,'src/index.js'),'corrupted local file');await writeFile(join(root,'src/deleted.js'),'should disappear');
  assert.equal(await restoreSourceCheckpoint(root,session.id),true);
  assert.equal(await readFile(join(root,'src/index.js'),'utf8'),'export const restored = true;\n');
  await assert.rejects(()=>readFile(join(root,'src/deleted.js')));
  await recordTokenUsage(session.id,'thread-proof',100,owner);await recordTokenUsage(session.id,'thread-proof',100,owner);await recordTokenUsage(session.id,'thread-proof',120,owner);
  assert.equal((await getSession(session.id)).metrics.providerTokens,120);
  await controlSession(session.id,'pause');assert.equal(await completeRevision(session.id,2,{status:'complete'},owner),false);
  assert.equal((await getSession(session.id)).status,'paused');assert.ok((await getIntents(session.id)).every(i=>i.status==='accepted'));
  await controlSession(session.id,'resume');assert.equal(await completeRevision(session.id,2,{status:'complete'},owner),true);
  assert.ok((await getIntents(session.id)).every(i=>i.status==='fulfilled'));
  await releaseLease(session.id,owner);
  await assert.rejects(()=>commitSourceCheckpoint(session.id,owner,checkpoint,files));
  console.log('PASS: Atlas concurrent idempotency, revision fence, single worker lease, atomic source checkpoint, deletion-preserving restore, token replay, pause boundary, and attributed fulfillment.');
} finally {
  const db=await database();
  for(const name of ['cv_intents','cv_events','cv_checkpoints','cv_source_checkpoints','cv_trajectory','cv_presence'])await db.collection(name).deleteMany({sessionId:session.id});
  await db.collection<{_id:string}>('cv_token_usage').deleteMany({_id:{$regex:`^${session.id}:`}});
  await db.collection<{_id:string}>('cv_sessions').deleteOne({_id:session.id});
  if(root)await rm(root,{recursive:true,force:true});await closeDatabase();
}

}
main().catch(error=>{console.error(error);process.exitCode=1});

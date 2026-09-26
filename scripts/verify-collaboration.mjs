import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.CONVERGE_URL??'http://127.0.0.1:3000';
const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Origin':base},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error??r.statusText);return data;};
const {session}=process.env.CONVERGE_SESSION_ID?{session:{id:process.env.CONVERGE_SESSION_ID}}:await post('/api/sessions',{name:'Stripe storefront · shared intent demo'});
await mkdir('.converge',{recursive:true});await writeFile('.converge/demo-id',session.id);
const read=async()=>{const r=await fetch(`${base}/api/sessions/${session.id}`);if(!r.ok)throw new Error(await r.text());return r.json();};
if(!process.env.CONVERGE_SESSION_ID)await post(`/api/sessions/${session.id}/intents`,{authorId:'alex',text:'Connect Stripe and display the complete active product catalog. Preserve the product names and prices.',clientRequestId:randomUUID()});
let second=Boolean(process.env.CONVERGE_SESSION_ID),last='',firstTurn;
if(second){const state=await read();firstTurn=state.events.find(e=>e.title==='New intent woven into the running turn')?.turnId;await post(`/api/sessions/${session.id}/control`,{action:'retry'});}
for(let n=0;n<150;n++){
  const state=await read();const s=state.session;
  if(!second&&s.activeTurnId){
    firstTurn=s.activeTurnId;
    await post(`/api/sessions/${session.id}/intents`,{authorId:'sam',text:'Add NEW badges to the 3 most recently added items on Stripe. Keep existing names and prices unchanged.',clientRequestId:randomUUID()});
    second=true;console.log('Sam amended Alex’s active Codex turn:',firstTurn);
  }
  const status=`${s.status} r${s.revision} · ${s.metrics.toolCalls} tools · ${s.metrics.steers} live amendments · ${s.metrics.checksPassed}/${s.metrics.checksTotal} checks`;
  if(status!==last){console.log(status);last=status;}
  if(second&&s.status==='complete'){
    assert.ok(s.metrics.steers>=1,'No live turn/steer was acknowledged');
    assert.ok(s.artifact?.checks.length>=4);assert.ok(s.artifact.checks.every(c=>c.passed));
    assert.equal(s.artifact.products.filter(p=>p.badge==='NEW').length,3);
    assert.equal(new Set(state.intents.map(i=>i.authorId)).size,2);
    assert.ok(s.sourceCheckpointId);assert.equal(s.processedRevision,2);
    const proof={verifiedAt:new Date().toISOString(),sessionId:s.id,codexThreadId:s.codexThreadId,firstTurn,provider:'OpenRouter',storage:'MongoDB Atlas',metrics:s.metrics,checks:s.artifact.checks,products:s.artifact.products,checkpoint:s.sourceCheckpointId,scope:'Stripe-compatible fixture; no live Stripe account'};
    await writeFile('.converge/demo-result.json',JSON.stringify(proof,null,2));console.log('PASS: two authors, live steering, protected checks, and atomic Atlas checkpoint.');process.exit(0);
  }
  if(['error','blocked'].includes(s.status))throw new Error(s.error??s.status);
  await new Promise(r=>setTimeout(r,3000));
}
throw new Error('The collaborative verification did not reach a terminal state in time.');

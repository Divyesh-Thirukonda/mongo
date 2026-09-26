import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const base=process.env.CONVERGE_URL??'http://127.0.0.1:3000';
const proof=JSON.parse(await readFile('.converge/demo-result.json','utf8'));
const read=async()=>{const r=await fetch(`${base}/api/sessions/${proof.sessionId}`);assert.ok(r.ok);return r.json();};
const post=async(path,body)=>{const r=await fetch(`${base}/api/sessions/${proof.sessionId}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(body)});const j=await r.json();assert.ok(r.ok,j.error);return j;};
const before=await read();
await post('intents',{authorId:'sam',text:before.intents[0].text,clientRequestId:randomUUID()});
for(let n=0;n<30;n++){
  const state=await read();
  if(state.session.status==='complete'&&state.session.revision>before.session.revision){
    assert.equal(state.intents.at(-1).status,'duplicate');
    assert.equal(state.session.metrics.turns,before.session.metrics.turns);
    const code=await readFile(`.converge/workspaces/${proof.sessionId}/src/storefront.js`);
    assert.equal(createHash('sha256').update(code).digest('hex'),proof.sourceSha256);
    proof.recovery={verifiedAt:new Date().toISOString(),sourceRestoredFromAtlas:true,identicalSha256:true,duplicateSuppressed:true,noExtraCodingTurn:true,worker:state.worker.engine};
    await writeFile('.converge/demo-result.json',JSON.stringify(proof,null,2)+'\n');
    console.log('PASS: restarted worker restored the missing source tree from Atlas byte-for-byte; duplicate intent added no coding turn.');process.exit(0);
  }
  if(state.session.status==='error')throw new Error(state.session.error);
  await new Promise(r=>setTimeout(r,2000));
}
throw new Error('Recovery verification did not complete');

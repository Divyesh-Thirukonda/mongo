import "server-only";
import { MongoClient, type ClientSession, type Db } from "mongodb";
import { randomUUID, createHash } from "node:crypto";
import type { Intent, PersonId, Session, SessionSnapshot, TrajectoryEvent, MemoryCheckpoint, Presence, RoutingDecision } from "./types";
import { buildPlan } from "./intent-router";
import { modelBudgetScopes, reserveModelBudgetScopes } from "./model-budget";

type SessionDoc = Session & { _id: string; eventSequence: number };
type IntentDoc = Intent & { _id: string; requestId: string };
type EventDoc = TrajectoryEvent & { _id: string };
type CheckpointDoc = MemoryCheckpoint & { _id: string };
type WorkerDoc = { _id: string; seenAt: Date; engine: string; host: string };
const pool = globalThis as typeof globalThis & { convergeClient?: Promise<MongoClient>; convergeInitialized?: Promise<void> };
export class StoreError extends Error { constructor(message: string, public status = 503) { super(message); } }
export function redact(value: string): string {
  let clean = value;
  for (const secret of [process.env.MONGODB_URI, process.env.OPENROUTER_API_KEY, process.env.VERCEL_OIDC_TOKEN]) if (secret) clean = clean.split(secret).join("[redacted]");
  return clean.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,"[redacted database URI]").replace(/\bsk-(?:or-v1-)?[a-z0-9_-]{12,}/gi,"[redacted key]").replace(/Bearer\s+[^\s"']+/gi,"Bearer [redacted]");
}
export async function database(): Promise<Db> {
  if (!process.env.MONGODB_URI) throw new StoreError("Connect the provisioned Atlas sandbox by setting MONGODB_URI in .env.local.");
  pool.convergeClient ??= new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 12, serverSelectionTimeoutMS: 7000, connectTimeoutMS: 7000 }).connect().catch(()=>{pool.convergeClient=undefined;throw new StoreError("Atlas is unavailable. Check the sandbox connection and network access.");});
  const db = (await pool.convergeClient).db(process.env.MONGODB_DB ?? "aegis");
  pool.convergeInitialized ??= Promise.all([
    db.collection("cv_sessions").createIndex({updatedAt:-1}),
    db.collection("cv_intents").createIndex({sessionId:1,revision:1},{unique:true}),
    db.collection("cv_events").createIndex({sessionId:1,sequence:1},{unique:true}),
    db.collection("cv_checkpoints").createIndex({sessionId:1,createdAt:-1}),
    db.collection("cv_trajectory").createIndex({sessionId:1,turnId:1,createdAt:1}),
    db.collection("cv_presence").createIndex({expiresAt:1},{expireAfterSeconds:0}),
    db.collection("cv_workers").createIndex({seenAt:1},{expireAfterSeconds:120}),
    db.collection("cv_budgets").createIndex({expiresAt:1},{expireAfterSeconds:0}),
  ]).then(()=>undefined).catch(()=>{pool.convergeInitialized=undefined;throw new StoreError("Atlas collection initialization failed.");});
  await pool.convergeInitialized; return db;
}
export async function transaction<T>(fn: (db:Db, tx:ClientSession)=>Promise<T>):Promise<T> {
  const db=await database(); const client=await pool.convergeClient!;
  return client.withSession(tx=>tx.withTransaction(()=>fn(db,tx),{readConcern:{level:"snapshot"},writeConcern:{w:"majority"}}));
}
const sessions=(db:Db)=>db.collection<SessionDoc>("cv_sessions");
function cleanSession(doc:SessionDoc):Session { const {_id,eventSequence,...session}=doc; void _id;void eventSequence; return session; }
function cleanIntent(doc:IntentDoc):Intent { const {_id,requestId,...intent}=doc;void _id;void requestId; return intent; }
const now=()=>new Date().toISOString();
async function eventInTx(db:Db, tx:ClientSession, sessionId:string, input:Omit<TrajectoryEvent,"id"|"sessionId"|"sequence"|"createdAt">):Promise<void> {
  const doc=await sessions(db).findOneAndUpdate({_id:sessionId},{$inc:{eventSequence:1,"metrics.archivedEvents":1},$set:{updatedAt:now()}},{session:tx,returnDocument:"after"});
  if(!doc) throw new StoreError("Session not found",404);
  const id=randomUUID();
  await db.collection<EventDoc>("cv_events").insertOne({_id:id,id,sessionId,sequence:doc.eventSequence,createdAt:now(),...input,title:redact(input.title).slice(0,300),detail:redact(input.detail).slice(0,8000)},{session:tx});
}
export async function appendEvent(sessionId:string,input:Omit<TrajectoryEvent,"id"|"sessionId"|"sequence"|"createdAt">) { await transaction((db,tx)=>eventInTx(db,tx,sessionId,input)); }
export async function createSession(name="Stripe storefront"):Promise<Session> {
  const db=await database();const at=now();const id=randomUUID();
  const session:Session={id,name:name.trim().slice(0,80)||"Untitled workspace",goal:"Build a shared storefront, one intent at a time.",createdAt:at,updatedAt:at,revision:0,processedRevision:0,status:"idle",plan:{summary:"Waiting for the first intent",steps:[],constraints:[],revision:0},metrics:{turns:0,toolCalls:0,mergedIntents:0,avoidedRuns:0,checksPassed:0,checksTotal:0,contextChars:0,archivedEvents:0,providerTokens:0,steers:0}};
  await sessions(db).insertOne({...session,_id:id,eventSequence:0});return session;
}
export async function listSessions():Promise<Session[]> { return (await sessions(await database()).find({}).sort({updatedAt:-1}).limit(40).toArray()).map(cleanSession); }
export async function getSession(id:string):Promise<Session> { const doc=await sessions(await database()).findOne({_id:id});if(!doc)throw new StoreError("Session not found",404);return cleanSession(doc); }
export async function getIntents(id:string):Promise<Intent[]> { return (await (await database()).collection<IntentDoc>("cv_intents").find({sessionId:id}).sort({revision:1}).toArray()).map(cleanIntent); }
export async function submitIntent(sessionId:string,authorId:PersonId,text:string,requestId:string):Promise<Intent> {
  return transaction(async(db,tx)=>{
    const col=db.collection<IntentDoc>("cv_intents"); const key=`${sessionId}:${requestId}`;
    const prior=await col.findOne({_id:key},{session:tx});
    if(prior){if(prior.text!==text.trim()||prior.authorId!==authorId)throw new StoreError("This request ID belongs to a different intent",409);return cleanIntent(prior);}
    const session=await sessions(db).findOne({_id:sessionId},{session:tx});if(!session)throw new StoreError("Session not found",404);
    const active=await col.countDocuments({sessionId,status:{$nin:["superseded","duplicate"]}},{session:tx});
    if(active>=64)throw new StoreError("This session has 64 active requirements. Start a new session to keep every contributor's intent in context.",409);
    const intent:Intent={id:randomUUID(),sessionId,authorId,text:text.trim(),createdAt:now(),revision:session.revision+1,status:"queued"};
    await col.insertOne({...intent,_id:key,requestId},{session:tx});
    await sessions(db).updateOne({_id:sessionId},{$set:{revision:intent.revision,updatedAt:now(),...(session.status==="idle"||session.status==="complete"||session.status==="error"?{status:"planning" as const}:{}),...(session.revision===0?{goal:text.trim().slice(0,180)}:{})}},{session:tx});
    await eventInTx(db,tx,sessionId,{kind:"intent",actor:authorId,title:"Intent received",detail:text,intentIds:[intent.id]});return intent;
  });
}
export async function applyRouting(sessionId:string,intentId:string,decision:RoutingDecision,owner:string):Promise<Intent> {
  return transaction(async(db,tx)=>{
    const current=await sessions(db).findOne({_id:sessionId,leaseOwner:owner,leaseUntil:{$gt:now()}},{session:tx});if(!current)throw new StoreError("Worker lease changed",409);
    const col=db.collection<IntentDoc>("cv_intents");const doc=await col.findOne({sessionId,id:intentId},{session:tx});if(!doc)throw new StoreError("Intent not found",404);if(doc.status!=="queued")return cleanIntent(doc);
    const status=decision.relation==="conflict"?"blocked":decision.relation==="duplicate"?"duplicate":"accepted";
    await col.updateOne({_id:doc._id},{$set:{decision,status}},{session:tx});
    const intents=(await col.find({sessionId},{session:tx}).sort({revision:1}).toArray()).map(cleanIntent);
    const merge=["extend","depend"].includes(decision.relation);
    await sessions(db).updateOne({_id:sessionId},{$set:{plan:buildPlan(intents,current.revision)},$inc:{"metrics.mergedIntents":merge?1:0,"metrics.avoidedRuns":merge||status==="duplicate"?1:0}},{session:tx});
    await eventInTx(db,tx,sessionId,{kind:status==="blocked"?"conflict":merge?"merge":"routing",actor:"Converge",title:decision.summary,detail:decision.reason+(decision.source==="rules"?" · Deterministic routing rules.":""),intentIds:[intentId,...decision.parentIntentIds]});
    return {...cleanIntent(doc),decision,status};
  });
}
export async function resolveIntent(sessionId:string,intentId:string,choice:"keep-existing"|"replace-existing") {
  await transaction(async(db,tx)=>{
    const col=db.collection<IntentDoc>("cv_intents"); const intent=await col.findOne({sessionId,id:intentId},{session:tx});if(!intent||intent.status!=="blocked")throw new StoreError("This conflict is no longer open",409);
    const current=await sessions(db).findOne({_id:sessionId},{session:tx});if(!current)throw new StoreError("Session not found",404);
    if(choice==="replace-existing")await col.updateMany({sessionId,id:{$in:intent.decision?.parentIntentIds??[]}},{$set:{status:"superseded"}},{session:tx});
    await col.updateOne({_id:intent._id},{$set:{status:choice==="keep-existing"?"superseded":"accepted",resolution:choice}},{session:tx});
    const intents=(await col.find({sessionId},{session:tx}).sort({revision:1}).toArray()).map(cleanIntent);
    await sessions(db).updateOne({_id:sessionId},{$inc:{revision:1},$set:{plan:buildPlan(intents,current.revision+1),status:current.pauseRequested?"paused":current.activeTurnId?"running":"planning",updatedAt:now()}},{session:tx});
    await eventInTx(db,tx,sessionId,{kind:"routing",actor:"Team",title:choice==="keep-existing"?"Existing direction retained":"New direction accepted",detail:"The team resolved the conflicting requirement. Its original author and text remain in the intent ledger.",intentIds:[intentId]});
  });
}
export async function updateSession(id:string,patch:Partial<Session>,owner?:string) {
  const set=Object.fromEntries(Object.entries(patch).filter(([,v])=>v!==undefined));
  const unset=Object.fromEntries(Object.entries(patch).filter(([,v])=>v===undefined).map(([k])=>[k,"" as const]));
  const result=await sessions(await database()).updateOne({_id:id,...(owner?{leaseOwner:owner,leaseUntil:{$gt:now()}}:{})},{$set:{...set,updatedAt:now()},...(Object.keys(unset).length?{$unset:unset}:{})});
  if(!result.matchedCount)throw new StoreError("Session or worker lease changed",409);
}
export async function incrementMetrics(id:string,values:Partial<Session["metrics"]>,owner:string) {
  const result=await sessions(await database()).updateOne({_id:id,leaseOwner:owner,leaseUntil:{$gt:now()}},{$inc:Object.fromEntries(Object.entries(values).map(([k,v])=>[`metrics.${k}`,v]))});if(!result.matchedCount)throw new StoreError("Worker lease changed",409);
}
export async function setMetrics(id:string,values:Partial<Session["metrics"]>,owner:string) {
  const result=await sessions(await database()).updateOne({_id:id,leaseOwner:owner,leaseUntil:{$gt:now()}},{$set:Object.fromEntries(Object.entries(values).map(([k,v])=>[`metrics.${k}`,v]))});if(!result.matchedCount)throw new StoreError("Worker lease changed",409);
}
export async function recordTokenUsage(id:string,threadId:string,total:number,owner:string) {
  if(!Number.isSafeInteger(total)||total<0)return;
  await transaction(async(db,tx)=>{
    const session=await sessions(db).findOne({_id:id,leaseOwner:owner,leaseUntil:{$gt:now()}},{session:tx});if(!session)throw new StoreError("Worker lease changed",409);
    const cursors=db.collection<{_id:string;total:number}>("cv_token_usage");const key=`${id}:${threadId}`;
    const previous=await cursors.findOne({_id:key},{session:tx});let baseline=previous?.total??0;
    if(!previous){
      const history=await db.collection<{data:string}>("cv_trajectory").find({sessionId:id,method:"thread/tokenUsage/updated"},{session:tx}).sort({createdAt:-1}).limit(10).toArray();
      for(const row of history){try{const item=JSON.parse(row.data);if(item.threadId===threadId)baseline=Math.max(baseline,item.tokenUsage?.total?.totalTokens??0);}catch{}}
    }
    await cursors.updateOne({_id:key},{$max:{total}},{upsert:true,session:tx});
    if(total>baseline)await sessions(db).updateOne({_id:id},{$inc:{"metrics.providerTokens":total-baseline}},{session:tx});
  });
}
export async function completeRevision(id:string,revision:number,patch:Partial<Session>,owner:string) {
  return transaction(async(db,tx)=>{
    const current=await sessions(db).findOne({_id:id,leaseOwner:owner,leaseUntil:{$gt:now()}},{session:tx});if(!current)throw new StoreError("Worker lease changed",409);
    const blocked=await db.collection<IntentDoc>("cv_intents").countDocuments({sessionId:id,status:"blocked"},{session:tx});
    const queued=await db.collection<IntentDoc>("cv_intents").countDocuments({sessionId:id,status:"queued"},{session:tx});
    const stale=current.revision!==revision||queued>0;
    await sessions(db).updateOne({_id:id},{$set:{...patch,processedRevision:stale||current.pauseRequested||blocked?current.processedRevision:revision,status:current.pauseRequested?"paused":stale?"planning":blocked?"blocked":patch.status??"complete",updatedAt:now()},$unset:{activeTurnId:""}},{session:tx});
    if(patch.status==="complete"&&!stale&&!blocked&&!current.pauseRequested)await db.collection<IntentDoc>("cv_intents").updateMany({sessionId:id,revision:{$lte:revision},status:"accepted"},{$set:{status:"fulfilled"}},{session:tx});
    const intents=(await db.collection<IntentDoc>("cv_intents").find({sessionId:id},{session:tx}).sort({revision:1}).toArray()).map(cleanIntent);
    await sessions(db).updateOne({_id:id},{$set:{plan:buildPlan(intents,current.revision)}},{session:tx});
    return !stale&&!current.pauseRequested;
  });
}
export async function controlSession(id:string,action:"pause"|"resume"|"retry") { const session=await getSession(id);await updateSession(id,{pauseRequested:action==="pause",status:action==="pause"?"paused":"planning",...(action==="retry"?{processedRevision:Math.max(0,session.revision-1)}:{}),error:undefined});await appendEvent(id,{kind:"system",actor:"Team",title:action==="pause"?"Work paused at the next safe boundary":"Work resumed",detail:"The shared intent ledger and coding thread are preserved.",intentIds:[]}); }
export async function acquireLease(id:string,owner:string):Promise<boolean> { const result=await sessions(await database()).findOneAndUpdate({_id:id,$or:[{leaseUntil:{$lt:now()}},{leaseUntil:{$exists:false}},{leaseOwner:owner}]},{$set:{leaseOwner:owner,leaseUntil:new Date(Date.now()+30000).toISOString()}});return Boolean(result); }
export async function renewLease(id:string,owner:string):Promise<boolean> {const result=await sessions(await database()).updateOne({_id:id,leaseOwner:owner,leaseUntil:{$gt:now()}},{$set:{leaseUntil:new Date(Date.now()+30000).toISOString()}});return Boolean(result.matchedCount);}
export async function releaseLease(id:string,owner:string) {await sessions(await database()).updateOne({_id:id,leaseOwner:owner},{$unset:{leaseOwner:"",leaseUntil:""}});}
export async function pendingSessions():Promise<Session[]> {return (await sessions(await database()).find({pauseRequested:{$ne:true},status:{$in:["planning","running","review"]}}).sort({updatedAt:1}).limit(20).toArray()).map(cleanSession);}
export async function heartbeatWorker(id:string,engine:string,host:string){await(await database()).collection<WorkerDoc>("cv_workers").updateOne({_id:id},{$set:{engine,host,seenAt:new Date()}},{upsert:true});}
export async function presence(sessionId:string,personId:PersonId){await getSession(sessionId);await(await database()).collection("cv_presence").updateOne({sessionId,personId},{$set:{seenAt:now(),expiresAt:new Date(Date.now()+45000)}},{upsert:true});}
export async function snapshot(id:string):Promise<SessionSnapshot>{
  return transaction(async(db,tx)=>{
  const doc=await sessions(db).findOne({_id:id},{session:tx});if(!doc)throw new StoreError("Session not found",404);
  const session=cleanSession(doc);
  const intents=(await db.collection<IntentDoc>("cv_intents").find({sessionId:id},{session:tx}).sort({revision:1}).toArray()).map(cleanIntent);
  const events=await db.collection<EventDoc>("cv_events").find({sessionId:id},{session:tx}).sort({sequence:-1}).limit(100).toArray();
  const checkpoints=await db.collection<CheckpointDoc>("cv_checkpoints").find({sessionId:id},{session:tx}).sort({createdAt:-1}).limit(8).toArray();
  const people=await db.collection<Presence>("cv_presence").find({sessionId:id,seenAt:{$gt:new Date(Date.now()-45000).toISOString()}},{session:tx}).toArray();
  const worker=await db.collection<WorkerDoc>("cv_workers").find({seenAt:{$gt:new Date(Date.now()-20000)}},{session:tx}).sort({seenAt:-1}).limit(1).next();
  return {session,intents,events:events.reverse().map(({_id,...e})=>{void _id;return e;}),checkpoints:checkpoints.map(({_id,...c})=>{void _id;return c;}),presence:people.map(p=>({sessionId:p.sessionId,personId:p.personId,seenAt:p.seenAt})),worker:{online:Boolean(worker),engine:worker?.engine??"Codex App Server",lastSeenAt:worker?.seenAt.toISOString()},storage:{mode:"atlas",connected:true}};
  });
}
export async function recordTrajectory(sessionId:string,turnId:string|undefined,method:string,payload:unknown){
  const raw=redact(JSON.stringify(payload));const digest=createHash("sha256").update(sessionId+method+raw).digest("hex");
  const chunks=raw.match(/[\s\S]{1,200000}/g)??[""];
  await(await database()).collection<{_id:string;sessionId:string;turnId?:string;method:string;data:string;chunk:number;chunks:number;createdAt:Date}>("cv_trajectory").bulkWrite(chunks.map((data,index)=>({updateOne:{filter:{_id:`${digest}:${index}`},update:{$setOnInsert:{sessionId,turnId,method,data,chunk:index,chunks:chunks.length,createdAt:new Date()}},upsert:true}})));
}
export async function claimModelBudget(sessionId:string):Promise<boolean>{
  for(let attempt=0;attempt<5;attempt++){
    try{return await transaction(async(db,tx)=>{
      const session=await sessions(db).findOne({_id:sessionId},{session:tx});if(!session)throw new StoreError("Session not found",404);
      const at=Date.now();return reserveModelBudgetScopes(db,tx,modelBudgetScopes(session,at),at);
    });}catch(error){
      // Simultaneous first claims can collide on an absent counter's unique ID.
      // The failed transaction consumed nothing; retry against the winning row.
      if(attempt===4||!error||typeof error!=="object"||!("code"in error)||error.code!==11000)throw error;
    }
  }
  return false;
}
export async function closeDatabase(){if(pool.convergeClient)await(await pool.convergeClient).close();pool.convergeClient=undefined;pool.convergeInitialized=undefined;}

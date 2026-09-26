import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {MODEL_BUDGET_LIMITS,MODEL_BUDGET_WINDOW_MS,modelBudgetScopes,reserveModelBudgetScopes} from '../lib/model-budget';

test('hourly model scopes bind collaborators to the persisted owner and isolate workspaces',()=>{
 const at=100*MODEL_BUDGET_WINDOW_MS+17;
 const first=modelBudgetScopes({id:'workspace-a',ownerId:'owner'},at),second=modelBudgetScopes({id:'workspace-b',ownerId:'owner'},at);
 assert.equal(first[0].key,'model:100');assert.equal(first[0].key,second[0].key);
 assert.notEqual(first[1].key,second[1].key);assert.equal(first[2].key,second[2].key);
 assert.notEqual(first[2].key,modelBudgetScopes({id:'workspace-a',ownerId:'different-owner'},at)[2].key);
 assert.deepEqual(first.map(scope=>scope.limit),[100,30,60]);assert.ok(MODEL_BUDGET_LIMITS.session>=20);
 assert.notEqual(first[0].key,modelBudgetScopes({id:'workspace-a'},at+MODEL_BUDGET_WINDOW_MS)[0].key);
 assert.equal(modelBudgetScopes({id:'private-legacy'},at).length,2);
});

test('Atlas budget admission is atomic under contention and denials charge no other scope',{skip:process.env.CONVERGE_BUDGET_INTEGRATION!=='1'},async()=>{
 const {database,transaction,closeDatabase}=await import('../lib/store');
 const db=await database(),prefix=`budget-test:${randomUUID()}`;
 const collection=db.collection<{_id:string;count:number;expiresAt?:Date}>('cv_budgets');
 const scopes=[{key:`${prefix}:global`,limit:20},{key:`${prefix}:workspace`,limit:4},{key:`${prefix}:owner`,limit:10}];
 const keys=[...scopes.map(scope=>scope.key),`${prefix}:other-workspace`];
 try{
  // Start from real existing rows to exercise transactional write contention,
  // without consuming the worker's live global/owner/workspace budgets.
  await collection.insertMany(scopes.map(scope=>({_id:scope.key,count:0})));
  const results=await Promise.all(Array.from({length:12},()=>transaction((db,tx)=>reserveModelBudgetScopes(db,tx,scopes))));
  assert.equal(results.filter(Boolean).length,4);
  assert.deepEqual((await collection.find({_id:{$in:scopes.map(scope=>scope.key)}}).toArray()).map(row=>row.count),[4,4,4]);
  assert.equal(await transaction((db,tx)=>reserveModelBudgetScopes(db,tx,scopes)),false);
  const next=[scopes[0],{key:`${prefix}:other-workspace`,limit:30},{...scopes[2],limit:5}];
  assert.equal(await transaction((db,tx)=>reserveModelBudgetScopes(db,tx,next)),true);
  assert.equal(await transaction((db,tx)=>reserveModelBudgetScopes(db,tx,next)),false);
  assert.equal((await collection.findOne({_id:scopes[0].key}))?.count,5);
  assert.equal((await collection.findOne({_id:next[1].key}))?.count,1);
  assert.equal((await collection.findOne({_id:scopes[2].key}))?.count,5);
  assert.ok((await collection.findOne({_id:next[1].key}))?.expiresAt instanceof Date);
  await assert.rejects(transaction((db,tx)=>reserveModelBudgetScopes(db,tx,[scopes[0],scopes[0]])),/Invalid model budget scopes/);
 }finally{await collection.deleteMany({_id:{$in:keys}});await closeDatabase();}
});

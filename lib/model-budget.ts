import {createHash} from 'node:crypto';
import type {ClientSession,Db} from 'mongodb';

export const MODEL_BUDGET_LIMITS=Object.freeze({global:100,session:30,owner:60});
export const MODEL_BUDGET_WINDOW_MS=3_600_000;
export interface ModelBudgetScope {key:string;limit:number}
type BudgetDocument={_id:string;count:number;expiresAt?:Date};

/** Owner identity comes from the persisted session, never the request author. */
export function modelBudgetScopes(session:{id:string;ownerId?:string},time=Date.now()):ModelBudgetScope[]{
 if(!session.id||!Number.isFinite(time)||time<0)throw new Error('Invalid model budget scope.');
 const hour=Math.floor(time/MODEL_BUDGET_WINDOW_MS);
 const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
 return[
  {key:`model:${hour}`,limit:MODEL_BUDGET_LIMITS.global},
  {key:`model-session:${digest(session.id)}:${hour}`,limit:MODEL_BUDGET_LIMITS.session},
  ...(session.ownerId?[{key:`model-owner:${digest(session.ownerId)}:${hour}`,limit:MODEL_BUDGET_LIMITS.owner}]:[]),
 ];
}

/** All counters commit together. The caller must run this inside a transaction. */
export async function reserveModelBudgetScopes(db:Db,tx:ClientSession,scopes:ModelBudgetScope[],time=Date.now()):Promise<boolean>{
 if(!scopes.length||scopes.length>3||new Set(scopes.map(scope=>scope.key)).size!==scopes.length||scopes.some(scope=>!scope.key||scope.key.length>180||!Number.isSafeInteger(scope.limit)||scope.limit<1))throw new Error('Invalid model budget scopes.');
 const collection=db.collection<BudgetDocument>('cv_budgets');
 const previous=await collection.find({_id:{$in:scopes.map(scope=>scope.key)}},{session:tx}).toArray();
 for(const scope of scopes){
  const count=previous.find(row=>row._id===scope.key)?.count??0;
  if(!Number.isSafeInteger(count)||count<0||count>=scope.limit)return false;
 }
 const expiresAt=new Date((Math.floor(time/MODEL_BUDGET_WINDOW_MS)+2)*MODEL_BUDGET_WINDOW_MS);
 // Sequential writes on one MongoDB ClientSession; a competing claim forces a
 // transaction retry, so no admitted operation can partially consume a scope.
 for(const scope of scopes)await collection.updateOne({_id:scope.key},{$inc:{count:1},$setOnInsert:{expiresAt}},{session:tx,upsert:true});
 return true;
}

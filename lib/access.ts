import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {database,snapshot,StoreError,transaction} from './store';
import type {Identity,Participant,SessionSnapshot} from './types';
export interface Membership {_id:string;sessionId:string;userId:string;role:'owner'|'member';createdAt:string}
type ParticipantDoc={_id:string;sessionId:string;userId:string;name:string;isAnonymous:boolean};
const colors=['#6579c5','#ad7854','#648776','#9868a1','#547eaa','#a36c76'];
export function normalizeName(value:string):string {const name=value.trim().replace(/\s+/g,' ');if(name.length<1||name.length>60||/[\u0000-\u001f<>]/.test(name))throw new StoreError('Choose a display name from 1 to 60 characters.',400);return name;}
export function publicIdentity(user:{id:string;name:string;email?:string;isAnonymous?:boolean|null}):Identity{return{id:user.id,name:user.name,isAnonymous:Boolean(user.isAnonymous),...(!user.isAnonymous&&user.email?{email:user.email}:{})};}
export function participant(user:Pick<Identity,'id'|'name'|'isAnonymous'>):Participant{return{id:user.id,name:user.name,initials:user.name.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]??'').join('').toUpperCase()||'G',color:colors[parseInt(createHash('sha256').update(user.id).digest('hex').slice(0,8),16)%colors.length],isAnonymous:user.isAnonymous};}
export async function getIdentity(request:Request):Promise<Identity|null>{const{getAuth}=await import('./auth');const session=await(await getAuth()).api.getSession({headers:request.headers,query:{disableCookieCache:true}});return session?publicIdentity(session.user):null;}
export async function requireUser(request:Request):Promise<Identity>{const user=await getIdentity(request);if(!user)throw new StoreError('Sign in or continue as a guest to use this workspace.',401);return user;}
export async function requireMembership(sessionId:string,user:Pick<Identity,'id'>):Promise<Membership>{
 const membership=await(await database()).collection<Membership>('cv_memberships').findOne({_id:`${sessionId}:${user.id}`,sessionId,userId:user.id});
 if(!membership)throw new StoreError('Workspace not found or unavailable to this account.',404);return membership;
}
export async function getParticipants(sessionId:string):Promise<Participant[]>{return(await(await database()).collection<ParticipantDoc>('cv_participants').find({sessionId}).limit(200).toArray()).map(row=>participant({id:row.userId,name:row.name,isAnonymous:row.isAnonymous}));}
export async function memberSnapshot(sessionId:string,user:Identity):Promise<SessionSnapshot>{
 await requireMembership(sessionId,user);
 const db=await database();await db.collection<ParticipantDoc>('cv_participants').updateOne({_id:`${sessionId}:${user.id}`},{$set:{sessionId,userId:user.id,name:user.name,isAnonymous:user.isAnonymous}},{upsert:true});
 const result=await snapshot(sessionId);delete result.session.leaseOwner;delete result.session.leaseUntil;
 return{...result,participants:await getParticipants(sessionId),currentUserId:user.id};
}
export async function consumeRateLimit(scope:string,key:string,limit:number,windowSeconds:number):Promise<void>{
 const window=Math.floor(Date.now()/(windowSeconds*1000)),id=createHash('sha256').update(`${scope}:${key}:${window}`).digest('hex');
 const result=await(await database()).collection<{_id:string;count:number;expiresAt:Date}>('cv_api_limits').findOneAndUpdate({_id:id},{$inc:{count:1},$setOnInsert:{expiresAt:new Date((window+2)*windowSeconds*1000)}},{upsert:true,returnDocument:'after'});
 if(!result||result.count>limit)throw new StoreError('This account has reached its request limit. Please wait before trying again.',429);
}
export async function limitUserAction(user:Identity,action:string,sessionId?:string){
 const daily=action==='intent'?(user.isAnonymous?30:200):action==='create'?(user.isAnonymous?3:30):action==='share'?20:action==='join'?30:120;
 await consumeRateLimit(`user:${action}`,user.id,daily,86400);
 if(sessionId&&(action==='intent'||action==='retry'))await consumeRateLimit(`session:${action}`,sessionId,action==='intent'?80:10,3600);
}
export function hashInvite(token:string):string {if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new StoreError('Invalid invitation.',400);return createHash('sha256').update(token).digest('hex');}
export async function createInvite(sessionId:string,user:Identity):Promise<{token:string;expiresAt:string}>{
 await requireMembership(sessionId,user);await limitUserAction(user,'share',sessionId);
 const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+7*86400000);
 await(await database()).collection<{_id:string;sessionId:string;createdBy:string;expiresAt:Date;uses:number}>('cv_invites').insertOne({_id:hashInvite(token),sessionId,createdBy:user.id,expiresAt,uses:0});
 return{token,expiresAt:expiresAt.toISOString()};
}
export async function joinInvite(token:string,user:Identity):Promise<string>{
 const digest=hashInvite(token);await limitUserAction(user,'join');
 return transaction(async(db,tx)=>{
  const invites=db.collection<{_id:string;sessionId:string;createdBy:string;expiresAt:Date;uses:number}>('cv_invites');
  const invite=await invites.findOne({_id:digest,expiresAt:{$gt:new Date()}},{session:tx});if(!invite)throw new StoreError('This invitation is invalid or expired.',404);
  const memberships=db.collection<Membership>('cv_memberships'),id=`${invite.sessionId}:${user.id}`;
  if(await memberships.findOne({_id:id},{session:tx}))return invite.sessionId;
  const session=await db.collection<{_id:string}>('cv_sessions').findOne({_id:invite.sessionId},{session:tx});if(!session)throw new StoreError('This invitation is invalid or expired.',404);
  if(await memberships.countDocuments({sessionId:invite.sessionId},{session:tx})>=20||await memberships.countDocuments({userId:user.id},{session:tx})>=100)throw new StoreError('Workspace membership limit reached.',429);
  await invites.updateOne({_id:digest},{$inc:{uses:1}},{session:tx});
  await memberships.insertOne({_id:id,sessionId:invite.sessionId,userId:user.id,role:'member',createdAt:new Date().toISOString()},{session:tx});
  await db.collection<ParticipantDoc>('cv_participants').updateOne({_id:id},{$set:{sessionId:invite.sessionId,userId:user.id,name:user.name,isAnonymous:user.isAnonymous}},{upsert:true,session:tx});
  return invite.sessionId;
 });
}
/** Guest upgrades transfer access, never rewrite the historical intent author IDs. */
export async function linkGuestAccount(anonymousId:string,user:Identity):Promise<void>{
 if(anonymousId===user.id)return;
 await transaction(async(db,tx)=>{
  const memberships=db.collection<Membership>('cv_memberships');const old=await memberships.find({userId:anonymousId},{session:tx}).toArray();
  for(const membership of old){
   const id=`${membership.sessionId}:${user.id}`,existing=await memberships.findOne({_id:id},{session:tx});
   if(!existing)await memberships.insertOne({...membership,_id:id,userId:user.id},{session:tx});
   else if(membership.role==='owner')await memberships.updateOne({_id:id},{$set:{role:'owner'}},{session:tx});
   await db.collection<ParticipantDoc>('cv_participants').updateOne({_id:id},{$set:{sessionId:membership.sessionId,userId:user.id,name:user.name,isAnonymous:false}},{upsert:true,session:tx});
  }
  await db.collection('cv_sessions').updateMany({ownerId:anonymousId},{$set:{ownerId:user.id}},{session:tx});
  await db.collection('cv_invites').updateMany({createdBy:anonymousId},{$set:{createdBy:user.id}},{session:tx});
  await db.collection('cv_agent_tokens').updateMany({userId:anonymousId},{$set:{userId:user.id}},{session:tx});
  await memberships.deleteMany({userId:anonymousId},{session:tx});
 });
}

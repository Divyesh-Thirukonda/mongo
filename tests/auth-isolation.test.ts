import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {UUID} from 'mongodb';
import {hashInvite,normalizeName,participant,publicIdentity} from '../lib/access';

test('identity projections omit anonymous email and derive stable participant colors',()=>{
 const guest=publicIdentity({id:'guest-id',name:'Maya Rao',email:'internal@anonymous.invalid',isAnonymous:true});
 assert.deepEqual(guest,{id:'guest-id',name:'Maya Rao',isAnonymous:true});
 assert.equal(participant(guest).initials,'MR');assert.equal(participant(guest).color,participant(guest).color);
 assert.equal(normalizeName('  Maya   Rao '),'Maya Rao');assert.throws(()=>normalizeName('<script>'));
});
test('invitation hashes are deterministic, opaque, and reject malformed secrets',()=>{
 const token=randomBytes(32).toString('base64url');const digest=hashInvite(token);
 assert.equal(digest.length,64);assert.notEqual(digest,token);assert.equal(hashInvite(token),digest);
 for(const invalid of ['',token+'x','../escape','a'.repeat(42)])assert.throws(()=>hashInvite(invalid));
});

test('Atlas auth isolates users, rejects spoofing, grants explicit invites, and migrates guest access', {skip:process.env.CONVERGE_AUTH_INTEGRATION!=='1'},async()=>{
 const [{POST:guest},{GET:identity},{GET:list,POST:create},{GET:read},{POST:intent},{POST:control},{POST:share},{POST:join},{POST:presence},{POST:resolve},{GET:stream},{getAuth},{database,closeDatabase}]=await Promise.all([
  import('../app/api/guest/route'),import('../app/api/identity/route'),import('../app/api/sessions/route'),import('../app/api/sessions/[id]/route'),import('../app/api/sessions/[id]/intents/route'),import('../app/api/sessions/[id]/control/route'),import('../app/api/sessions/[id]/share/route'),import('../app/api/join/route'),import('../app/api/sessions/[id]/presence/route'),import('../app/api/sessions/[id]/resolve/route'),import('../app/api/sessions/[id]/stream/route'),import('../lib/auth'),import('../lib/store'),
 ]);
 const origin=process.env.BETTER_AUTH_URL??'http://127.0.0.1:3000',userIds=new Set<string>(),sessionIds:string[]=[];
 const request=(path:string,method='GET',cookie='',data?:unknown)=>new Request(`${origin}${path}`,{method,headers:{origin,host:new URL(origin).host,...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const cookies=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const parse=async(response:Response,status:number)=>{assert.equal(response.status,status,`Unexpected status for auth isolation request: ${response.status}`);return response.json();};
 let a='',b='';
 try{
  const responseA=await guest(request('/api/guest','POST','',{name:'Isolation Guest A'}));const ua=(await parse(responseA,201)).user;a=cookies(responseA);userIds.add(ua.id);assert.ok(responseA.headers.getSetCookie().some(value=>/httponly/i.test(value)));assert.equal(ua.name,'Isolation Guest A');
  const responseB=await guest(request('/api/guest','POST','',{name:'Isolation Guest B'}));const ub=(await parse(responseB,201)).user;b=cookies(responseB);userIds.add(ub.id);assert.notEqual(ua.id,ub.id);
  assert.equal((await parse(await identity(request('/api/identity','GET',a)),200)).user.id,ua.id);
  await parse(await list(request('/api/sessions')),401);
  const session=(await parse(await create(request('/api/sessions','POST',a,{name:'Auth isolation integration fixture'})),201)).session;sessionIds.push(session.id);
  const context={params:Promise.resolve({id:session.id})};
  await parse(await control(request(`/api/sessions/${session.id}/control`,'POST',a,{action:'pause'}),context),200);
  assert.ok(!(await parse(await list(request('/api/sessions','GET',b)),200)).sessions.some((item:{id:string})=>item.id===session.id));
  await parse(await read(request(`/api/sessions/${session.id}`,'GET',b),context),404);
  await parse(await stream(request(`/api/sessions/${session.id}/stream`,'GET',b),context),404);
  await parse(await control(request(`/api/sessions/${session.id}/control`,'POST',b,{action:'resume'}),context),404);
  await parse(await presence(request(`/api/sessions/${session.id}/presence`,'POST',b,{}),context),404);
  await parse(await resolve(request(`/api/sessions/${session.id}/resolve`,'POST',b,{intentId:randomUUID(),choice:'keep-existing'}),context),404);
  await parse(await share(request(`/api/sessions/${session.id}/share`,'POST',b,{}),context),404);
  await parse(await intent(request(`/api/sessions/${session.id}/intents`,'POST',a,{text:'Paused test requirement',clientRequestId:randomUUID(),authorId:ub.id}),context),400);
  await parse(await presence(request(`/api/sessions/${session.id}/presence`,'POST',a,{personId:ub.id}),context),400);
  const added=(await parse(await intent(request(`/api/sessions/${session.id}/intents`,'POST',a,{text:'Paused test requirement',clientRequestId:randomUUID()}),context),201)).intent;assert.equal(added.authorId,ua.id);
  const invite=await parse(await share(request(`/api/sessions/${session.id}/share`,'POST',a,{}),context),201);
  assert.equal((await parse(await join(request('/api/join','POST',b,{token:invite.token})),200)).sessionId,session.id);
  const shared=await parse(await read(request(`/api/sessions/${session.id}`,'GET',b),context),200);assert.equal(shared.currentUserId,ub.id);assert.equal(shared.participants.length,2);assert.equal(shared.session.pauseRequested,true);
  const auth=await getAuth(),email=`converge-isolation-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
  const signupResponse=await auth.handler(request('/api/auth/sign-up/email','POST',a,{name:'Registered isolation user',email,password}));const registered=(await parse(signupResponse,200)).user;userIds.add(registered.id);const registeredCookie=cookies(signupResponse);
  assert.equal((await parse(await read(request(`/api/sessions/${session.id}`,'GET',registeredCookie),context),200)).session.ownerId,registered.id);
  await parse(await read(request(`/api/sessions/${session.id}`,'GET',a),context),404);
  const signInResponse=await auth.handler(request('/api/auth/sign-in/email','POST',b,{email,password}));await parse(signInResponse,200);const linkedCookie=cookies(signInResponse);
  const linked=await parse(await read(request(`/api/sessions/${session.id}`,'GET',linkedCookie),context),200);assert.equal(linked.currentUserId,registered.id);assert.ok(linked.participants.some((person:{id:string})=>person.id===ua.id));assert.ok(linked.participants.some((person:{id:string})=>person.id===ub.id));
  await parse(await read(request(`/api/sessions/${session.id}`,'GET',b),context),404);
 }finally{
  const db=await database();
  for(const name of ['cv_sessions','cv_memberships','cv_participants','cv_intents','cv_events','cv_checkpoints','cv_source_checkpoints','cv_presence','cv_trajectory','cv_invites','cv_agent_tokens'])await db.collection(name).deleteMany(name==='cv_sessions'?{_id:{$in:sessionIds}as never}:{sessionId:{$in:sessionIds}});
  const authIds=[...userIds].map(id=>new UUID(id));
  for(const name of ['cv_auth_sessions','cv_auth_accounts'])await db.collection(name).deleteMany({userId:{$in:authIds}});
  await db.collection('cv_auth_users').deleteMany({_id:{$in:authIds}as never});
  await closeDatabase();
 }
});

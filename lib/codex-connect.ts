import 'server-only';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {consumeRateLimit,requireMembership} from './access';
import {appendEvent,database,snapshot,StoreError,redact} from './store';
import {buildContext} from './context';
import type {Identity} from './types';
export interface AgentConnection {_id:string;sessionId:string;userId:string;createdAt:Date;expiresAt:Date}
export function agentTokenHash(token:string):string{
 if(!/^cvg_[A-Za-z0-9_-]{43}$/.test(token))throw new StoreError('Invalid Codex connection.',401);
 return createHash('sha256').update(token).digest('hex');
}
export function connectionCommand(sessionId:string,origin:string,token:string):string{
 agentTokenHash(token);const url=new URL('/api/codex/mcp',origin);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid server URL');
 const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 return ['codex','mcp','add',`converge-${sessionId.slice(0,8)}`,'--env',quote(`CONVERGE_AUTH=Bearer ${token}`),'--','npx','--yes','mcp-remote@0.14.3',quote(url.href),'--header',quote('Authorization:${CONVERGE_AUTH}'),'--transport','http-only'].join(' ');
}
export async function createAgentConnection(sessionId:string,user:Identity,origin:string){
 await requireMembership(sessionId,user);await consumeRateLimit('codex-connect',user.id,12,86400);
 const token=`cvg_${randomBytes(32).toString('base64url')}`,expiresAt=new Date(Date.now()+7*86400000);
 const db=await database();await db.collection('cv_agent_tokens').createIndex({expiresAt:1},{expireAfterSeconds:0});
 await db.collection<AgentConnection>('cv_agent_tokens').insertOne({_id:agentTokenHash(token),sessionId,userId:user.id,createdAt:new Date(),expiresAt});
 return {token,expiresAt:expiresAt.toISOString(),serverUrl:new URL('/api/codex/mcp',origin).href,command:connectionCommand(sessionId,origin,token)};
}
export async function authenticateAgent(request:Request):Promise<AgentConnection>{
 const authorization=request.headers.get('authorization')??'';
 if(!authorization.startsWith('Bearer '))throw new StoreError('Connect Codex from the session to get a scoped connection token.',401);
 const digest=agentTokenHash(authorization.slice(7));
 const connection=await(await database()).collection<AgentConnection>('cv_agent_tokens').findOne({_id:digest,expiresAt:{$gt:new Date()}});
 if(!connection)throw new StoreError('This Codex connection has expired or was revoked. Connect again from the session.',401);
 await requireMembership(connection.sessionId,{id:connection.userId});
 await consumeRateLimit('codex-requests',digest,120,60);
 return connection;
}
export const progressSchema=z.object({
 title:z.string().trim().min(1).max(180),detail:z.string().max(6000),
 kind:z.enum(['agent','tool']).default('agent'),intentIds:z.array(z.string().uuid()).max(64).default([]),
 trajectoryId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
}).strict();
export async function sharedContext(connection:AgentConnection){
 const state=await snapshot(connection.sessionId);const context=buildContext(state.session,state.intents,state.checkpoints,state.events);
 return {sessionId:state.session.id,name:state.session.name,revision:state.session.revision,status:state.session.status,context:context.text,contextChars:context.chars,latestSequence:state.events.at(-1)?.sequence??0,instructions:'Preserve every accepted or fulfilled requirement. Blocked requests require human resolution. Report actual progress using report_progress; these reports do not assert protected verification or mark requirements complete.'};
}
export async function reportAgentProgress(connection:AgentConnection,input:unknown){
 const data=progressSchema.parse(input);const state=await snapshot(connection.sessionId);
 const allowed=new Set(state.intents.map(i=>i.id));if(data.intentIds.some(id=>!allowed.has(id)))throw new StoreError('A progress report references an intent outside this session.',400);
 const trajectoryId=`external-${connection._id.slice(0,12)}-${data.trajectoryId??'codex'}`;
 await appendEvent(connection.sessionId,{kind:data.kind,actor:'Codex · connected',title:data.title,detail:data.detail,intentIds:data.intentIds,source:'connected-agent',externalTrajectoryId:trajectoryId,actorUserId:connection.userId});
 await(await database()).collection<{_id:string;sessionId:string;connectionId:string;actorUserId:string;createdAt:Date;trajectoryId:string;report:unknown}>('cv_external_trajectory').insertOne({_id:randomUUID(),sessionId:connection.sessionId,connectionId:connection._id,actorUserId:connection.userId,createdAt:new Date(),trajectoryId,report:JSON.parse(redact(JSON.stringify(data)))});
 return {recorded:true,sessionId:connection.sessionId,revision:state.session.revision,source:'connected-agent' as const,externalTrajectoryId:trajectoryId};
}

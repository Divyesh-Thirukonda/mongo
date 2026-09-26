import {z} from 'zod';
import {createSession,listSessions} from '@/lib/store';
import {requireUser,limitUserAction,consumeRateLimit} from '@/lib/access';
import {body,json,failure,validateWriteOrigin} from '../_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{validateWriteOrigin(request);const user=await requireUser(request);await consumeRateLimit('session-reads',user.id,180,60);const sessions=await listSessions(user.id);for(const session of sessions){delete session.leaseOwner;delete session.leaseUntil;}return json({sessions});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const input=await body(request,z.object({name:z.string().max(80).optional()}).strict()),user=await requireUser(request);await limitUserAction(user,'create');return json({session:await createSession(input.name,user)},201);}catch(error){return failure(error);}}

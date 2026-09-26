import {z} from 'zod';
import {controlSession} from '@/lib/store';
import {requireUser,requireMembership,limitUserAction,consumeRateLimit} from '@/lib/access';
import {body,json,failure,validId} from '../../../_shared';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);const input=await body(request,z.object({action:z.enum(['pause','resume','retry'])}).strict()),user=await requireUser(request);await requireMembership(id,user);await consumeRateLimit('control',user.id,20,60);if(input.action!=='pause')await limitUserAction(user,'retry',id);await controlSession(id,input.action);return json({ok:true});}catch(error){return failure(error);}}

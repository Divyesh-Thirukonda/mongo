import {z} from 'zod';
import {resolveIntent} from '@/lib/store';
import {requireUser,requireMembership,consumeRateLimit} from '@/lib/access';
import {body,json,failure,validId,idSchema} from '../../../_shared';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);const input=await body(request,z.object({intentId:idSchema,choice:z.enum(['keep-existing','replace-existing'])}).strict()),user=await requireUser(request);await requireMembership(id,user);await consumeRateLimit('resolve',user.id,20,60);await resolveIntent(id,input.intentId,input.choice);return json({ok:true});}catch(error){return failure(error);}}

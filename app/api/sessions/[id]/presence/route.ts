import {z} from 'zod';
import {presence} from '@/lib/store';
import {requireUser,requireMembership,consumeRateLimit} from '@/lib/access';
import {body,json,failure,validId} from '../../../_shared';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);await body(request,z.object({}).strict());const user=await requireUser(request);await requireMembership(id,user);await consumeRateLimit('presence',user.id,12,60);await presence(id,user.id);return json({ok:true});}catch(error){return failure(error);}}

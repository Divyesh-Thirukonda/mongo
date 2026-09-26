import {z} from 'zod';
import {submitIntent} from '@/lib/store';
import {requireUser,requireMembership,limitUserAction} from '@/lib/access';
import {body,json,failure,validId} from '../../../_shared';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);const input=await body(request,z.object({text:z.string().trim().min(2).max(2000),clientRequestId:z.string().min(8).max(80).regex(/^[a-zA-Z0-9-]+$/)}).strict()),user=await requireUser(request);await requireMembership(id,user);await limitUserAction(user,'intent',id);return json({intent:await submitIntent(id,user.id,input.text,input.clientRequestId)},201);}catch(error){return failure(error);}}

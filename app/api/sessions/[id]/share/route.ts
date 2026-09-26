import {z} from 'zod';
import {createInvite,requireUser} from '@/lib/access';
import {body,failure,json,requestOrigin,validId} from '../../../_shared';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);await body(request,z.object({}).strict());const invite=await createInvite(id,await requireUser(request));const origin=process.env.CONVERGE_PUBLIC_URL??process.env.BETTER_AUTH_URL??requestOrigin(request);return json({...invite,url:`${new URL(origin).origin}/?join=${invite.token}`},201);}catch(error){return failure(error);}}

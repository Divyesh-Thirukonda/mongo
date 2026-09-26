import {z} from 'zod';
import {joinInvite,requireUser} from '@/lib/access';
import {body,failure,json} from '../_shared';
export const runtime='nodejs';
export async function POST(request:Request){try{const input=await body(request,z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict());return json({sessionId:await joinInvite(input.token,await requireUser(request))});}catch(error){return failure(error);}}

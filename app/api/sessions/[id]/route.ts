import {requireUser,memberSnapshot,consumeRateLimit} from '@/lib/access';
import {json,failure,validId,validateWriteOrigin} from '../../_shared';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{validateWriteOrigin(request);const{id}=await context.params;validId(id);const user=await requireUser(request);await consumeRateLimit('session-reads',user.id,180,60);return json(await memberSnapshot(id,user));}catch(error){return failure(error);}}

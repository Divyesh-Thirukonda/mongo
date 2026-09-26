import {createAgentConnection} from '@/lib/codex-connect';
import {requireUser} from '@/lib/access';
import {json,failure,validId,validateWriteOrigin} from '../../../../_shared';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{validateWriteOrigin(request);const {id}=await context.params;validId(id);const user=await requireUser(request);
 const origin=process.env.CONVERGE_PUBLIC_URL??process.env.BETTER_AUTH_URL??new URL(request.url).origin;
 return json(await createAgentConnection(id,user,origin));
 }catch(error){return failure(error);}
}

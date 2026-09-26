import {snapshot} from "@/lib/store";
import {json,failure,validId,validateWriteOrigin} from "../../_shared";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{validateWriteOrigin(request);const{id}=await context.params;validId(id);return json(await snapshot(id));}catch(e){return failure(e);}}

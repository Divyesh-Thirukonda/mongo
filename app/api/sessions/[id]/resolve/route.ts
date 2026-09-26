import { z } from "zod";
import {resolveIntent} from "@/lib/store";
import {body,json,failure,validId,idSchema} from "../../../_shared";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);const input=await body(request,z.object({intentId:idSchema,choice:z.enum(["keep-existing","replace-existing"])}).strict());await resolveIntent(id,input.intentId,input.choice);return json({ok:true});}catch(e){return failure(e);}}

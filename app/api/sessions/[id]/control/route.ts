import { z } from "zod";
import {controlSession} from "@/lib/store";
import {body,json,failure,validId} from "../../../_shared";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);const input=await body(request,z.object({action:z.enum(["pause","resume","retry"])}).strict());await controlSession(id,input.action);return json({ok:true});}catch(e){return failure(e);}}

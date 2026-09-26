import { z } from "zod";
import {submitIntent} from "@/lib/store";
import {body,json,failure,validId,personSchema} from "../../../_shared";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);const input=await body(request,z.object({text:z.string().trim().min(2).max(2000),authorId:personSchema,clientRequestId:z.string().min(8).max(80).regex(/^[a-zA-Z0-9-]+$/)}).strict());return json({intent:await submitIntent(id,input.authorId,input.text,input.clientRequestId)},201);}catch(e){return failure(e);}}

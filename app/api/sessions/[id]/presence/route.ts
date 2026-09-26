import { z } from "zod";
import {presence} from "@/lib/store";
import {body,json,failure,validId,personSchema} from "../../../_shared";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){try{const{id}=await context.params;validId(id);const input=await body(request,z.object({personId:personSchema}).strict());await presence(id,input.personId);return json({ok:true});}catch(e){return failure(e);}}

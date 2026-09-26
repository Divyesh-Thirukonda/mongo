import { z } from "zod";
import { createSession,listSessions } from "@/lib/store";
import {body,json,failure,validateWriteOrigin} from "../_shared";
export const runtime="nodejs";
export async function GET(request:Request){try{validateWriteOrigin(request);return json({sessions:await listSessions()});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const input=await body(request,z.object({name:z.string().max(80).optional()}).strict());return json({session:await createSession(input.name)},201);}catch(e){return failure(e);}}

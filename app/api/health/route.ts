import {database} from "@/lib/store";
import {json,failure,validateWriteOrigin} from "../_shared";
export const runtime="nodejs";
export async function GET(request:Request){try{validateWriteOrigin(request);await(await database()).command({ping:1});return json({application:"Converge",database:{mode:"atlas",connected:true},provider:{configured:Boolean(process.env.OPENROUTER_API_KEY)},engine:"Codex App Server"});}catch(e){return failure(e);}}

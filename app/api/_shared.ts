import { z } from "zod";
import { StoreError } from "@/lib/store";
export const idSchema=z.string().uuid();
export const personSchema=z.enum(["alex","sam","jordan"]);
export function validateWriteOrigin(request:Request):void {
  const denied=()=>new StoreError("Only same-origin requests to the local Converge application are allowed.",403);
  const local=(url:URL)=>["127.0.0.1","localhost","[::1]"].includes(url.hostname)&&["http:","https:"].includes(url.protocol)&&!url.username&&!url.password;
  let url:URL;
  try{url=new URL(request.url);}catch{throw denied();}
  if(!local(url))throw denied();
  // Host is attacker-controlled during DNS rebinding; validate it independently,
  // never use it as an alternative origin allowlist.
  const host=request.headers.get("host");
  let expectedOrigin=url.origin;
  // Next may normalize the internal URL to localhost while Host remains 127.0.0.1.
  // Both names must independently be loopback, and the actual port must still match.
  if(host){let target:URL;try{target=new URL(`${url.protocol}//${host}`);}catch{throw denied();}if(!local(target)||target.port!==url.port||target.pathname!=="/"||target.search||target.hash)throw denied();expectedOrigin=target.origin;}
  const site=request.headers.get("sec-fetch-site");
  if(site&&site!=="same-origin"&&site!=="none")throw denied();
  const origin=request.headers.get("origin");
  if(origin){let source:URL;try{source=new URL(origin);}catch{throw denied();}if(!local(source)||source.origin!==expectedOrigin||source.pathname!=="/"||source.search||source.hash)throw denied();}
  else if(site&&site!=="none"&&!["GET","HEAD"].includes(request.method))throw denied();
}
export async function body<T>(request:Request,schema:z.ZodType<T>):Promise<T>{
  validateWriteOrigin(request);
  const text=await request.text();if(text.length>12000)throw new StoreError("Request is too large.",413);
  try{return schema.parse(JSON.parse(text||"{}"));}catch{throw new StoreError("Check the request fields and try again.",400);}
}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
export function failure(error:unknown){return json({error:error instanceof StoreError?error.message:"The operation could not be completed. Check Atlas and retry."},error instanceof StoreError?error.status:503);}
export function validId(id:string){if(!idSchema.safeParse(id).success)throw new StoreError("Invalid session ID",400);}

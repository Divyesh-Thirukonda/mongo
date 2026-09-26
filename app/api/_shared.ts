import { z } from "zod";
import { StoreError } from "@/lib/store";
export const idSchema=z.string().uuid();
export const personSchema=z.enum(["alex","sam","jordan"]);
export function requestOrigin(request:Request):string {
  const denied=()=>new StoreError("Only same-origin requests to this Converge application are allowed.",403);
  const local=(url:URL)=>["127.0.0.1","localhost","[::1]"].includes(url.hostname)&&["http:","https:"].includes(url.protocol)&&!url.username&&!url.password;
  const trusted=new Set<string>();
  for(const value of [process.env.BETTER_AUTH_URL,process.env.CONVERGE_PUBLIC_URL])if(value){try{const configured=new URL(value);if(!configured.username&&!configured.password&&configured.pathname==='/'&&!configured.search&&!configured.hash&&(configured.protocol==='https:'||local(configured)))trusted.add(configured.origin);}catch{throw denied();}}
  let url:URL;try{url=new URL(request.url);}catch{throw denied();}
  if(!local(url)&&!trusted.has(url.origin))throw denied();
  let expectedOrigin=url.origin;
  const host=request.headers.get("host");
  if(host){
    let target:URL;try{target=new URL(`${url.protocol}//${host}`);}catch{throw denied();}
    if(target.username||target.password||target.pathname!=="/"||target.search||target.hash)throw denied();
    const configured=[...trusted].find(origin=>new URL(origin).host===target.host);
    if(configured)expectedOrigin=configured;
    else if(local(url)&&local(target)&&target.port===url.port)expectedOrigin=target.origin;
    else throw denied();
  }
  return expectedOrigin;
}
export function validateWriteOrigin(request:Request):void {
  const denied=()=>new StoreError("Only same-origin requests to this Converge application are allowed.",403);
  const expectedOrigin=requestOrigin(request),site=request.headers.get("sec-fetch-site");
  if(site&&site!=="same-origin"&&site!=="none")throw denied();
  const origin=request.headers.get("origin");
  if(origin){let source:URL;try{source=new URL(origin);}catch{throw denied();}if(source.origin!==expectedOrigin||source.username||source.password||source.pathname!=="/"||source.search||source.hash)throw denied();}
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

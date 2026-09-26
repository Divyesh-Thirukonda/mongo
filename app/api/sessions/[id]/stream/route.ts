import {database,getSession} from "@/lib/store";
import {failure,validId,validateWriteOrigin} from "../../../_shared";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{
    validateWriteOrigin(request);const{id}=await context.params;validId(id);await getSession(id);const db=await database();
    const changes=db.collection("cv_events").watch([{$match:{operationType:"insert","fullDocument.sessionId":id}}],{maxAwaitTimeMS:1000});
    const encoder=new TextEncoder();let stopped=false;let timer:ReturnType<typeof setInterval>|undefined;
    const close=()=>{stopped=true;if(timer)clearInterval(timer);void changes.close();};
    const stream=new ReadableStream({start(controller){
      const send=(text:string)=>{if(!stopped)try{controller.enqueue(encoder.encode(text));}catch{close();}};
      send("event: change\ndata: ready\n\n");timer=setInterval(()=>send(": heartbeat\n\n"),15000);
      changes.on("change",()=>send("event: change\ndata: updated\n\n"));
      changes.on("error",()=>{send("event: reconnect\ndata: polling\n\n");close();try{controller.close();}catch{}});
      request.signal.addEventListener("abort",()=>{close();try{controller.close();}catch{}},{once:true});
    },cancel:close});
    return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"}});
  }catch(e){return failure(e);}
}

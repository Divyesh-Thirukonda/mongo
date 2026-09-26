import {database} from '@/lib/store';
import {requireUser,requireMembership,consumeRateLimit} from '@/lib/access';
import {failure,validId,validateWriteOrigin} from '../../../_shared';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{
  validateWriteOrigin(request);const{id}=await context.params;validId(id);const user=await requireUser(request);await requireMembership(id,user);await consumeRateLimit('stream',user.id,30,300);
  const changes=(await database()).collection('cv_events').watch([{$match:{operationType:'insert','fullDocument.sessionId':id}}],{maxAwaitTimeMS:1000});
  const encoder=new TextEncoder();let stopped=false,timer:ReturnType<typeof setInterval>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
  const close=()=>{stopped=true;if(timer)clearInterval(timer);if(deadline)clearTimeout(deadline);void changes.close();};
  const stream=new ReadableStream({start(controller){
   const end=()=>{close();try{controller.close();}catch{}};
   const send=(text:string)=>{if(!stopped)try{controller.enqueue(encoder.encode(text));}catch{close();}};
   send('event: change\ndata: ready\n\n');
   timer=setInterval(()=>{void(async()=>{try{const current=await requireUser(request);await requireMembership(id,current);if(current.id!==user.id){end();return;}send(': heartbeat\n\n');}catch{end();}})();},15000);
   deadline=setTimeout(end,50000);
   changes.on('change',()=>send('event: change\ndata: updated\n\n'));
   changes.on('error',()=>{send('event: reconnect\ndata: polling\n\n');end();});
   request.signal.addEventListener('abort',end,{once:true});if(request.signal.aborted)end();
  },cancel:close});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}});
 }catch(error){return failure(error);}
}

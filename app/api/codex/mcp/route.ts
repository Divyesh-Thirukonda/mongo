import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import {authenticateAgent,agentCheckpoint,progressSchema,reportAgentProgress,sharedContext} from '@/lib/codex-connect';
import {snapshot,StoreError} from '@/lib/store';
import {validateWriteOrigin} from '../../_shared';
export const runtime='nodejs';
export const maxDuration=60;
const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
export async function POST(request:Request){
 try{
  validateWriteOrigin(request);const connection=await authenticateAgent(request);
  if(Number(request.headers.get('content-length')??0)>16000)throw new StoreError('MCP request is too large.',413);
  const server=new McpServer({name:'Converge',version:'0.3.0'});
  server.registerTool('read_shared_context',{description:'Read the current shared goal, all active attributed intents, and compact durable memory for this Converge session. Use before editing and after updates.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false}},async()=>result(await sharedContext(connection)));
  server.registerTool('check_status',{description:'Confirm scoped authentication and read the latest revision, conflicts, pause/restore state, and permission boundaries. This is a status check, not a filesystem lock.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false}},async()=>{const context=await sharedContext(connection);return result({authenticated:context.authenticated,connectedAs:context.connectedAs,sessionId:context.sessionId,latestSequence:context.latestSequence,...context.control});});
  server.registerTool('read_checkpoint',{description:'Recover saved memory and source from this workspace in a new Codex task. Without path, returns checkpoint metadata and file hashes; pass a listed path to retrieve its exact saved content.',inputSchema:{checkpointId:z.string().max(160).regex(/^[a-zA-Z0-9_-]+$/).optional(),path:z.string().max(240).optional()},annotations:{readOnlyHint:true,openWorldHint:false}},async({checkpointId,path})=>result(await agentCheckpoint(connection,checkpointId,path)));
  server.registerTool('report_progress',{description:'Publish a truthful coding update or actual tool result into the shared live trajectory graph. Reports are attributed to the connected Codex and do not certify checks as passed.',inputSchema:progressSchema.shape,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async(input)=>result(await reportAgentProgress(connection,input)));
  server.registerTool('read_changes',{description:'Read the latest source diff and project check results saved by the managed coding worker.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false}},async()=>{const state=await snapshot(connection.sessionId);return result({revision:state.session.revision,artifact:state.session.artifact??null});});
  server.registerTool('wait_for_updates',{description:'Wait up to 20 seconds for a newer human intent revision, then return the current shared context. Use at work boundaries to integrate teammates’ changes.',inputSchema:{afterRevision:z.number().int().nonnegative(),afterSequence:z.number().int().nonnegative().optional(),timeoutSeconds:z.number().int().min(1).max(20).default(10)},annotations:{readOnlyHint:true,openWorldHint:false}},async({afterRevision,afterSequence,timeoutSeconds})=>{const deadline=Date.now()+timeoutSeconds*1000;let state=await sharedContext(connection);while(state.revision<=afterRevision&&(afterSequence===undefined||state.latestSequence<=afterSequence)&&!state.control.shouldWait&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1200));state=await sharedContext(connection);}return result({...state,changed:state.revision>afterRevision||(afterSequence!==undefined&&state.latestSequence>afterSequence)});});
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:16000});
  await server.connect(transport);
  try{return await transport.handleRequest(request);}finally{await server.close();}
 }catch(error){return Response.json({error:error instanceof StoreError?error.message:'The Codex connection could not complete this request.'},{status:error instanceof StoreError?error.status:503,headers:{'Cache-Control':'no-store'}});}
}
export async function GET(){return new Response(null,{status:405,headers:{Allow:'POST'}});}
export async function DELETE(){return new Response(null,{status:405,headers:{Allow:'POST'}});}

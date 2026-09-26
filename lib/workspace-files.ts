import "server-only";
import { cp, mkdir, realpath, readdir, lstat, readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Artifact, Intent } from "./types";
import { createHash } from "node:crypto";
import { captureWorkspace } from "./source-checkpoint";
import { buildWebsitePreview } from "./website-preview";
import { redact } from "./store";
import { restoreSourceCheckpoint } from "./source-checkpoint";
const exec=promisify(execFile);
export const workspaceRoot=()=>resolve(process.env.CONVERGE_DATA_DIR??join(process.cwd(),'.converge'));
export async function prepareWorkspace(sessionId:string):Promise<string>{
  if(!/^[a-f0-9-]{36}$/.test(sessionId))throw new Error('Invalid workspace identity');
  const root=join(workspaceRoot(),'workspaces',sessionId);await mkdir(root,{recursive:true});
  const resolved=await realpath(root);if(resolved!==root)throw new Error('Workspace symlinks are not supported');
  const files=await readdir(root);
  if(!files.length){
    await cp(join(process.cwd(),'fixtures/workspace'),root,{recursive:true});
    await exec('git',['init','-q'],{cwd:root});
    await exec('git',['add','.'],{cwd:root});
    await exec('git',['-c','user.name=Converge','-c','user.email=converge@local.invalid','commit','-qm','Initial coding workspace'],{cwd:root});
    await restoreSourceCheckpoint(root,sessionId);
  }
  // Upgrade only the untouched legacy starter instructions; preserve user-authored files.
  const readme=await readFile(join(root,'README.md'),'utf8').catch(()=>'');
  if(createHash('sha256').update(readme).digest('hex')==='1663515d354df887f4a69fec31cc459072bc8171cb5bc6e8b4533d18c861076b')
    await writeFile(join(root,'README.md'),await readFile(join(process.cwd(),'fixtures/workspace/README.md'),'utf8'));
  return root;
}
export async function verifyWorkspace(root:string,intents:Intent[],revision:number):Promise<Artifact>{
  const {z}=await import('zod');
  const sources=await captureWorkspace(root);
  const intentIds=intents.filter(i=>i.status==='accepted'||i.status==='fulfilled').map(i=>i.id);
  const verifier=resolve('scripts/verify-workspace.mjs');
  const binary=process.env.CONVERGE_CODEX_BINARY??'/Applications/ChatGPT.app/Contents/Resources/codex';
  const runtimeRoot=dirname(dirname(await realpath(process.execPath)));
  const profile=`permissions.converge_check.filesystem={":root"="deny",":minimal"="read",${JSON.stringify(root)}="read",${JSON.stringify(verifier)}="read",${JSON.stringify(runtimeRoot)}="read","/opt/homebrew"="read"}`;
  const testFiles=sources.map(f=>f.path).filter(path=>/\.(test|spec)\.(js|mjs|cjs|ts|mts|cts)$/.test(path));
  const args=['sandbox','-C',root,'-P','converge_check','-c','permissions.converge_check.extends=":read-only"','-c','permissions.converge_check.network.enabled=false','-c',profile,'--',process.execPath,verifier,root,JSON.stringify(testFiles)];
  const {stdout}=await exec(binary,args,{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8',NODE_ENV:'production',...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},encoding:'utf8',timeout:15000,maxBuffer:256*1024});
  const result=z.object({passed:z.boolean(),testCount:z.number().int().nonnegative(),detail:z.string().max(16000)}).strict().parse(JSON.parse(stdout.trim()));
  const checks=[
    {name:'Implementation files saved',passed:sources.some(f=>!f.path.startsWith('tests/')&&!/\.(test|spec)\./.test(f.path)&&!/^(README\.md|package(-lock)?\.json)$/.test(f.path)),detail:`${sources.length} files captured with verified checksums.`,intentIds},
    {name:'Project tests',passed:result.passed,detail:result.detail,intentIds},
  ];
  if(sources.some(f=>f.path==='index.html'||f.path==='public/index.html')){
    try{const preview=await buildWebsitePreview(sources);checks.push({name:'Website preview builds',passed:!!preview,detail:'The actual HTML entry and local imports compile.',intentIds});}
    catch(error){checks.push({name:'Website preview builds',passed:false,detail:redact(error instanceof Error?error.message:'Preview build failed.'),intentIds});}
  }
  const options={cwd:root,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',NODE_ENV:'production' as const,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},encoding:'utf8' as const,maxBuffer:1024*1024};
  const safeGit=['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null'];
  const [{stdout:diff},{stdout:stat},{stdout:untracked}]=await Promise.all([exec('git',[...safeGit,'diff','HEAD','--no-ext-diff','--no-textconv','--','.',':(exclude).converge*'],options),exec('git',[...safeGit,'diff','HEAD','--numstat','--','.',':(exclude).converge*'],options),exec('git',[...safeGit,'ls-files','--others','--exclude-standard'],options)]);
  const files=stat.trim().split('\n').filter(Boolean).map(line=>{const[a,d,path]=line.split('\t');return{path,additions:Number(a)||0,deletions:Number(d)||0};});
  let extra='';
  for(const path of untracked.trim().split('\n').filter(Boolean).slice(0,15)){
    const absolute=resolve(root,path),rel=relative(root,absolute);if(rel.startsWith('..')||isAbsolute(rel))continue;
    const info=await lstat(absolute);if(!info.isFile()||info.isSymbolicLink()||info.size>50000||await realpath(absolute)!==absolute)continue;
    const text=redact(await readFile(absolute,'utf8'));files.push({path,additions:text.split('\n').length,deletions:0});extra+=`\n+++ ${path}\n`+text.split('\n').map(l=>'+'+l).join('\n');
  }
  return {files,diff:redact(diff+extra).slice(0,60000),checks,reviewRequired:true,verifiedRevision:revision,updatedAt:new Date().toISOString()};
}

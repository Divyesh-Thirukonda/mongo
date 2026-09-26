import "server-only";
import { cp, mkdir, realpath, readdir, lstat, readFile } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Artifact, Intent } from "./types";
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
    await cp(join(process.cwd(),'fixtures/stripe-store'),root,{recursive:true});
    await exec('git',['init','-q'],{cwd:root});
    await exec('git',['add','.'],{cwd:root});
    await exec('git',['-c','user.name=Converge','-c','user.email=converge@local.invalid','commit','-qm','Initial Stripe-compatible fixture'],{cwd:root});
    await restoreSourceCheckpoint(root,sessionId);
  }
  return root;
}
export function verificationRequirements(intents:Intent[]){
  const active=intents.filter(i=>i.status==='accepted'||i.status==='fulfilled');
  const stripe=active.filter(i=>/stripe|catalog|products|storefront/i.test(i.text)&&!/\b(new|badge|label|remove|hide)\b/i.test(i.text));
  const badges=active.filter(i=>/\b(new|badge|label)\b/i.test(i.text)&&!/\b(remove|hide|without|no badges|don't|do not)\b/i.test(i.text));
  const remove=active.filter(i=>/\b(remove|hide|without|no badges|don't|do not)\b/i.test(i.text)&&/\b(new|badge|label)\b/i.test(i.text));
  const last=badges.at(-1);const amount=last?.text.match(/\b(\d{1,2})\b/);const count=amount?Math.min(20,Math.max(1,Number(amount[1]))):/\btwo\b/i.test(last?.text??'')?2:3;
  const label=last?.text.match(/(?:label|badge|mark).*?["'“]([^"'”]{1,20})["'”]/i)?.[1]??'NEW';
  const known=new Set([...stripe,...badges,...remove].map(i=>i.id));
  return {stripeIntentIds:stripe.map(i=>i.id),badgeIntentIds:badges.map(i=>i.id),badgeCount:count,badgeLabel:label,removeBadgeIntentIds:remove.map(i=>i.id),unverifiedIntentIds:active.filter(i=>!known.has(i.id)).map(i=>i.id)};
}
export async function verifyWorkspace(root:string,intents:Intent[],revision:number):Promise<Artifact>{
  const {z}=await import('zod');
  const requirements=verificationRequirements(intents);
  const verifier=resolve('scripts/verify-workspace.mjs');const binary=process.env.CONVERGE_CODEX_BINARY??'/Applications/ChatGPT.app/Contents/Resources/codex';
  const runtimeRoot=dirname(dirname(await realpath(process.execPath)));
  const profile=`permissions.converge_check.filesystem={":root"="deny",":minimal"="read",${JSON.stringify(root)}="read",${JSON.stringify(verifier)}="read",${JSON.stringify(runtimeRoot)}="read","/opt/homebrew"="read"}`;
  const args=['sandbox','-C',root,'-P','converge_check','-c','permissions.converge_check.extends=":read-only"','-c','permissions.converge_check.network.enabled=false','-c',profile,'--',process.execPath,verifier,root,JSON.stringify(requirements)];
  const {stdout}=await exec(binary,args,{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8',NODE_ENV:'production',...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},encoding:'utf8',timeout:12000,maxBuffer:1024*1024});
  const result=z.object({checks:z.array(z.object({name:z.string().min(1).max(180),passed:z.boolean(),detail:z.string().min(1).max(1000),intentIds:z.array(z.string().max(120)).max(64)}).strict()).min(3).max(6),products:z.array(z.object({id:z.string().min(1).max(100),name:z.string().max(200),price:z.number().finite().min(0).max(1e9),created:z.number().int().min(0),badge:z.string().max(40).optional()}).strict()).max(30),stripeConnected:z.boolean()}).strict().parse(JSON.parse(stdout.trim()));
  const expected=[
    {name:'Stripe adapter returns the complete active catalog',intentIds:requirements.stripeIntentIds},
    {name:'Pagination follows the last product cursor',intentIds:requirements.stripeIntentIds},
    {name:'Names and prices are preserved',intentIds:requirements.stripeIntentIds},
    ...(requirements.badgeIntentIds.length?[{name:`Only the ${requirements.badgeCount} newest products receive ${requirements.badgeLabel}`,intentIds:requirements.badgeIntentIds}]:[]),
    ...(requirements.removeBadgeIntentIds.length?[{name:'Product badges are removed',intentIds:requirements.removeBadgeIntentIds}]:[]),
    ...(requirements.unverifiedIntentIds.length?[{name:'Additional acceptance criteria need review',intentIds:requirements.unverifiedIntentIds}]:[]),
  ];
  if(result.checks.length!==expected.length||result.checks.some((check,index)=>check.name!==expected[index].name||JSON.stringify(check.intentIds)!==JSON.stringify(expected[index].intentIds)))throw new Error('Protected verifier returned an unexpected acceptance-check manifest');
  const options={cwd:root,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',NODE_ENV:'production' as const,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},encoding:'utf8' as const,maxBuffer:1024*1024};
  const safeGit=['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null'];
  const [{stdout:diff},{stdout:stat},{stdout:untracked}]=await Promise.all([exec('git',[...safeGit,'diff','HEAD','--no-ext-diff','--no-textconv','--','src','tests','package.json'],options),exec('git',[...safeGit,'diff','HEAD','--numstat','--','src','tests','package.json'],options),exec('git',[...safeGit,'ls-files','--others','--exclude-standard'],options)]);
  const files=stat.trim().split('\n').filter(Boolean).map(line=>{const[a,d,path]=line.split('\t');return{path,additions:Number(a)||0,deletions:Number(d)||0};});
  let extra='';
  for(const path of untracked.trim().split('\n').filter(Boolean).slice(0,15)){
    const absolute=resolve(root,path),rel=relative(root,absolute);if(rel.startsWith('..')||isAbsolute(rel))continue;
    const info=await lstat(absolute);if(!info.isFile()||info.isSymbolicLink()||info.size>50000||await realpath(absolute)!==absolute)continue;
    const text=redact(await readFile(absolute,'utf8'));files.push({path,additions:text.split('\n').length,deletions:0});extra+=`\n+++ ${path}\n`+text.split('\n').map(l=>'+'+l).join('\n');
  }
  return {files,diff:redact(diff+extra).slice(0,60000),checks:result.checks,products:result.products,stripeConnected:Boolean(result.stripeConnected),verifiedRevision:revision,updatedAt:new Date().toISOString()};
}

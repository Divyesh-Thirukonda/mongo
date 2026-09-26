// The trusted parent owns assertions. Generated source executes only in a bounded child
// under the same OS sandbox, with Node filesystem permissions and no child-process access.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const filename = fileURLToPath(import.meta.url);
const source = [
  {id:'prod_linen',name:'Linen everyday tote',created:1700000900,active:true,default_price:{unit_amount:3200}},
  {id:'prod_ceramic',name:'Studio ceramic cup',created:1700000100,active:true,default_price:{unit_amount:2400}},
  {id:'prod_notebook',name:'Field notes set',created:1700000800,active:true,default_price:{unit_amount:1800}},
  {id:'prod_archived',name:'Archived edition',created:1700000999,active:false,default_price:{unit_amount:9900}},
  {id:'prod_lamp',name:'Arc desk lamp',created:1700000700,active:true,default_price:{unit_amount:8900}},
  {id:'prod_tray',name:'Oak catchall tray',created:1700000200,active:true,default_price:{unit_amount:4500}},
];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function expectedChecks(requirements) {
  const checks = [
    {name:'Stripe adapter returns the complete active catalog',intentIds:requirements.stripeIntentIds},
    {name:'Pagination follows the last product cursor',intentIds:requirements.stripeIntentIds},
    {name:'Names and prices are preserved',intentIds:requirements.stripeIntentIds},
  ];
  if(requirements.badgeIntentIds.length) checks.push({name:`Only the ${requirements.badgeCount} newest products receive ${requirements.badgeLabel}`,intentIds:requirements.badgeIntentIds});
  if(requirements.removeBadgeIntentIds.length) checks.push({name:'Product badges are removed',intentIds:requirements.removeBadgeIntentIds});
  if(requirements.unverifiedIntentIds.length) checks.push({name:'Additional acceptance criteria need review',intentIds:requirements.unverifiedIntentIds});
  return checks;
}

function validateRequirements(value) {
  if (!object(value)) throw new Error('Invalid verification requirements');
  for (const field of ['stripeIntentIds','badgeIntentIds','removeBadgeIntentIds','unverifiedIntentIds'])
    if (!Array.isArray(value[field]) || value[field].length > 64 || value[field].some(id => typeof id !== 'string' || id.length > 120)) throw new Error('Invalid verification requirement IDs');
  if (!Number.isInteger(value.badgeCount) || value.badgeCount < 1 || value.badgeCount > 20 || typeof value.badgeLabel !== 'string' || value.badgeLabel.length > 40) throw new Error('Invalid badge requirements');
  return value;
}

function sanitizeResult(value) {
  if (!object(value) || typeof value.provider !== 'string' || value.provider.length > 80 || !Array.isArray(value.products) || value.products.length > 30) throw new Error('Invalid source result');
  const products = value.products.map(product => {
    if (!object(product) || typeof product.id !== 'string' || !product.id || product.id.length > 100 || typeof product.name !== 'string' || product.name.length > 200 || !Number.isFinite(product.price) || product.price < 0 || product.price > 1e9 || !Number.isSafeInteger(product.created) || product.created < 0 || (product.badge !== undefined && (typeof product.badge !== 'string' || product.badge.length > 40))) throw new Error('Invalid source product');
    return {id:product.id,name:product.name,price:product.price,created:product.created,...(product.badge === undefined ? {} : {badge:product.badge})};
  });
  return {provider:value.provider,products};
}

function executeSource(root) {
  return new Promise((resolveRun, rejectRun) => {
    const args = ['--max-old-space-size=64','--permission',`--allow-fs-read=${root}`,`--allow-fs-read=${filename}`,filename,'--source-child',root];
    const child = spawn(process.execPath,args,{cwd:root,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',NODE_ENV:'production',...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},stdio:['ignore','pipe','pipe','ipc'],serialization:'json',shell:false});
    const calls = [], requestIds = new Set();
    let settled = false, bytes = 0;
    const timer = setTimeout(() => finish(new Error('Source execution exceeded its time limit.')), 5000);
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timer); child.kill('SIGKILL');
      if (error) rejectRun(error); else resolveRun({result,calls});
    }
    const drain = chunk => { bytes += chunk.length; if (bytes > 65536) finish(new Error('Source execution exceeded its output limit.')); };
    child.stdout.on('data',drain); child.stderr.on('data',drain);
    child.on('error',()=>finish(new Error('Source execution could not start.')));
    child.on('exit',()=>{ if(!settled)finish(new Error('Source execution ended without a valid result.')); });
    child.on('message',message=>{
      if(settled)return;
      try {
        if(!object(message)||JSON.stringify(message).length>65536)throw new Error('Invalid source IPC message.');
        if(message.type==='stripe-list') {
          if(!Number.isSafeInteger(message.id)||message.id<1||requestIds.has(message.id)||calls.length>=8||!object(message.params)||JSON.stringify(message.params).length>8000)throw new Error('Invalid Stripe adapter request.');
          requestIds.add(message.id); calls.push(message.params);
          const data = calls.length===1 ? source.slice(0,2) : source.slice(2);
          child.send({type:'stripe-result',id:message.id,result:{data,has_more:calls.length===1}},error=>{if(error)finish(new Error('Source IPC closed prematurely.'));});
        } else if(message.type==='result') finish(undefined,sanitizeResult(message.result));
        else throw new Error('Source execution failed or emitted an unsupported IPC message.');
      }catch(error){finish(error);}
    });
  });
}

async function sourceChild(root) {
  let nextId = 0;
  const pending = new Map();
  const send = process.send.bind(process);
  process.on('message',message=>{
    if(message?.type==='stripe-result'&&pending.has(message.id)){
      pending.get(message.id)(message.result);pending.delete(message.id);
    }
  });
  const stripe={products:{list:params=>new Promise(resolvePage=>{
    const id=++nextId;pending.set(id,resolvePage);send({type:'stripe-list',id,params});
  })}};
  try {
    const {loadStorefront}=await import(pathToFileURL(resolve(root,'src/storefront.js')).href);
    const result=await loadStorefront(stripe);
    send({type:'result',result});
  } catch { send({type:'failure'}); }
}

export async function verify(root, input) {
  const requirements=validateRequirements(input), expected=expectedChecks(requirements);
  let run;
  try { run=await executeSource(resolve(root)); }
  catch(error) { return {checks:expected.map(check=>({...check,passed:false,detail:error.message})),stripeConnected:false,products:[]}; }
  const {result,calls}=run, products=result.products;
  const active=source.filter(product=>product.active), ids=active.map(product=>product.id).sort();
  const answers = [
    [result.provider==='stripe'&&JSON.stringify(products.map(product=>product.id).sort())===JSON.stringify(ids),'Two pages, including an inactive product, are verified independently.'],
    [calls.length===2&&calls[1]?.starting_after===source[1].id,'The second request must use the last product ID from the first page.'],
    [active.every(product=>products.some(item=>item.id===product.id&&item.name===product.name&&item.price===product.default_price.unit_amount/100&&item.created===product.created)),'The verifier checks source values in its own process.'],
  ];
  if(requirements.badgeIntentIds.length){
    const ids=active.toSorted((a,b)=>b.created-a.created||a.id.localeCompare(b.id)).slice(0,requirements.badgeCount).map(product=>product.id).sort();
    const actual=products.filter(product=>product.badge===requirements.badgeLabel).map(product=>product.id).sort();
    answers.push([JSON.stringify(ids)===JSON.stringify(actual)&&products.every(product=>!product.badge||product.badge===requirements.badgeLabel),'Input order is shuffled and inactive products cannot receive the badge.']);
  }
  if(requirements.removeBadgeIntentIds.length)answers.push([products.every(product=>!product.badge),'A resolved removal request supersedes the earlier badge instruction.']);
  if(requirements.unverifiedIntentIds.length)answers.push([false,'These intents fall outside the protected Stripe demonstration checks. Review the source diff.']);
  return {checks:expected.map((check,index)=>({...check,passed:Boolean(answers[index][0]),detail:answers[index][1]})),stripeConnected:result.provider==='stripe',products};
}

if (process.argv[1] && resolve(process.argv[1])===filename) {
  const run=process.argv[2]==='--source-child'
    ? sourceChild(process.argv[3])
    : verify(process.argv[2],JSON.parse(process.argv[3])).then(result=>console.log(JSON.stringify(result)));
  void run.catch(()=>{process.stderr.write('Protected verification could not complete.\n');process.exitCode=1;});
}

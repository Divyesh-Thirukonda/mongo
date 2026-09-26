// Trusted process records project-test evidence. It never declares human requirements fulfilled.
import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verify(root, files) {
  root=await realpath(root);
  if(!Array.isArray(files)||files.length>40)throw new Error('Invalid test manifest.');
  for(const file of files){
    if(typeof file!=='string'||!/^([a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(test|spec)\.(js|mjs|cjs|ts|mts|cts)$/.test(file))throw new Error('Invalid test path.');
    const absolute=resolve(root,file), rel=relative(root,absolute), info=await lstat(absolute);
    if(rel.startsWith('..')||isAbsolute(rel)||info.isSymbolicLink()||!info.isFile()||await realpath(absolute)!==absolute)throw new Error('Tests must be regular workspace files.');
  }
  if(!files.length)return {passed:false,testCount:0,detail:'No project tests found. Add meaningful *.test.js or *.test.ts files for the requested behavior.'};
  return new Promise(resolveRun=>{
    const child=spawn(process.execPath,['--max-old-space-size=128','--permission',`--allow-fs-read=${root}`,'--test','--test-isolation=none','--test-reporter=tap',...files],{cwd:root,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',NODE_ENV:'test',...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},stdio:['ignore','pipe','pipe'],shell:false});
    let output='',bytes=0,reason='';
    const stop=message=>{reason=message;child.kill('SIGKILL');};
    const timer=setTimeout(()=>stop('Project tests exceeded the 10 second time limit.'),10000);
    const collect=chunk=>{bytes+=chunk.length;if(bytes>128*1024){stop('Project tests exceeded the output limit.');return;}output+=chunk.toString();};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',()=>{reason='Project test process could not start.';});
    child.on('close',code=>{
      clearTimeout(timer);
      const testCount=Number(output.match(/^# tests (\d+)$/m)?.[1]??0);
      const passed=!reason&&code===0&&testCount>0&&Number(output.match(/^# pass (\d+)$/m)?.[1]??0)>0;
      resolveRun({passed,testCount,detail:(reason||`${passed?'Passed':'Failed'}: ${testCount} project tests. These are project-authored checks; review requirements separately.\n${output.slice(-10000)}`).slice(0,16000)});
    });
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  verify(process.argv[2],JSON.parse(process.argv[3])).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Project verification could not complete.');process.exitCode=1;});
}

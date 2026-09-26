import {z} from 'zod';
import {getAuth} from '@/lib/auth';
import {getIdentity,normalizeName,publicIdentity} from '@/lib/access';
import {StoreError} from '@/lib/store';
import {body,failure,json,requestOrigin} from '../_shared';
export const runtime='nodejs';
export async function POST(request:Request){try{
 const input=await body(request,z.object({name:z.string().min(1).max(60)}).strict()),name=normalizeName(input.name),auth=await getAuth(),current=await getIdentity(request);
 if(current){if(!current.isAnonymous)throw new StoreError('You are already signed in.',409);await auth.api.updateUser({headers:request.headers,body:{name}});return json({user:{...current,name}});}
 const headers=new Headers(request.headers);headers.set('x-converge-guest-name',name);headers.set('content-type','application/json');headers.delete('content-length');
 const response=await auth.handler(new Request(`${requestOrigin(request)}/api/auth/sign-in/anonymous`,{method:'POST',headers,body:'{}'}));
 if(!response.ok)return response;
 const result=await response.json();const output=json({user:publicIdentity({...result.user,isAnonymous:true})},201);
 for(const cookie of response.headers.getSetCookie())output.headers.append('set-cookie',cookie);
 return output;
}catch(error){return failure(error);}}

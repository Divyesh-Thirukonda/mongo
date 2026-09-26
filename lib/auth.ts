import 'server-only';
import {betterAuth} from 'better-auth';
import {mongodbAdapter} from 'better-auth/adapters/mongodb';
import {anonymous} from 'better-auth/plugins';
import {database,databaseClient,StoreError} from './store';
import {linkGuestAccount,normalizeName,publicIdentity} from './access';
export function configuredOrigins():string[]{
 const origins=new Set<string>();
 for(const value of [process.env.BETTER_AUTH_URL,process.env.CONVERGE_PUBLIC_URL]){
  if(!value)continue;const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new StoreError('The public application URL must be an exact HTTP(S) origin.');
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new StoreError('Public authentication requires HTTPS.');
  origins.add(url.origin);
 }
 return [...origins];
}
async function initializeAuth(){
 const secret=process.env.BETTER_AUTH_SECRET;if(!secret||secret.length<32)throw new StoreError('Authentication is not configured. Set BETTER_AUTH_SECRET to at least 32 random characters.');
 const origins=configuredOrigins(),baseURL=origins[0]??'http://127.0.0.1:3000';
 const localPort=new URL(baseURL).port||process.env.CONVERGE_PORT||'3000';
 return betterAuth({
  appName:'Converge',baseURL,secret,basePath:'/api/auth',
  database:mongodbAdapter(await database(),{client:await databaseClient(),transaction:true}),
  trustedOrigins:[...origins,`http://127.0.0.1:${localPort}`,`http://localhost:${localPort}`,`http://[::1]:${localPort}`],
  emailAndPassword:{enabled:true,minPasswordLength:10,maxPasswordLength:128,requireEmailVerification:false},
  user:{modelName:'cv_auth_users'},session:{modelName:'cv_auth_sessions',expiresIn:60*60*24*30,updateAge:60*60*24,cookieCache:{enabled:false}},
  account:{modelName:'cv_auth_accounts'},verification:{modelName:'cv_auth_verifications'},
  advanced:{cookiePrefix:'converge',defaultCookieAttributes:{httpOnly:true,sameSite:'lax',path:'/'},database:{generateId:'uuid'},ipAddress:{ipAddressHeaders:process.env.VERCEL==='1'?['x-vercel-forwarded-for','x-forwarded-for']:[]}},
  rateLimit:{enabled:true,storage:'database',modelName:'cv_auth_rate_limits',window:60,max:60,customRules:{'/sign-in/anonymous':{window:3600,max:10},'/sign-in/email':{window:60,max:8},'/sign-up/email':{window:3600,max:10}}},
  plugins:[anonymous({generateName:ctx=>normalizeName(ctx.headers?.get('x-converge-guest-name')??'Guest'),disableDeleteAnonymousUser:true,onLinkAccount:async({anonymousUser,newUser})=>{await linkGuestAccount(anonymousUser.user.id,publicIdentity({...newUser.user,isAnonymous:false}));}})],
 });
}
type ConvergeAuth=Awaited<ReturnType<typeof initializeAuth>>;
const globalAuth=globalThis as typeof globalThis&{convergeAuth?:Promise<ConvergeAuth>};
export function getAuth():Promise<ConvergeAuth>{return globalAuth.convergeAuth??=initializeAuth().catch(error=>{globalAuth.convergeAuth=undefined;throw error;});}

import {getAuth} from '@/lib/auth';
import {failure,validateWriteOrigin} from '../../_shared';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request){try{validateWriteOrigin(request);return(await getAuth()).handler(request);}catch(error){return failure(error);}}
export const GET=handle;
export const POST=handle;

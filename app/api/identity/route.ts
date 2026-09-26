import {getIdentity} from '@/lib/access';
import {failure,json,validateWriteOrigin} from '../_shared';
export const runtime='nodejs';
export async function GET(request:Request){try{validateWriteOrigin(request);return json({user:await getIdentity(request)});}catch(error){return failure(error);}}

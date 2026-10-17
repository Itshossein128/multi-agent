import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface ResolvedAddress { address: string; family: number }
export interface PinnedRequestInit extends RequestInit { pinnedAddress?: ResolvedAddress }
export type DestinationResolver = (hostname: string) => Promise<ResolvedAddress[]>;
const forbidden = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24],
  ['192.88.99.0',24], ['192.168.0.0',16], ['198.18.0.0',15], ['198.51.100.0',24],
  ['203.0.113.0',24], ['224.0.0.0',3],
] as const) forbidden.addSubnet(ip,prefix,'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
for (const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) forbidden.addSubnet(ip,prefix,'ipv6');
export function isPublicAddress(address: string): boolean {
  const family=isIP(address);
  if(family===4) return !forbidden.check(address,'ipv4');
  if(family===6) return globalV6.check(address,'ipv6') && !forbidden.check(address,'ipv6');
  return false;
}
export const resolveDestination: DestinationResolver = hostname => lookup(hostname,{all:true,verbatim:true});
export async function validateDestination(url: URL, resolve: DestinationResolver): Promise<ResolvedAddress> {
  if(url.protocol!=='http:' && url.protocol!=='https:') throw new Error('HTTP destination only permits http(s) URLs.');
  if(url.username || url.password) throw new Error('HTTP destination credentials are forbidden.');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  const family=isIP(hostname);
  const addresses=family ? [{address:hostname,family}] : await resolve(hostname);
  if(!addresses.length || addresses.some(a=>!isPublicAddress(a.address) || isIP(a.address)!==a.family)) throw new Error('HTTP destination has a forbidden or unresolved address.');
  return addresses[0];
}
/** No DNS is performed by the connector. TLS still uses the original hostname. */
export function pinnedHttpFetch(input: RequestInfo | URL, init: PinnedRequestInit = {}): Promise<Response> {
  const url=new URL(String(input));
  const address=init.pinnedAddress;
  if(!address) return Promise.reject(new Error('Validated HTTP address is required.'));
  return new Promise((resolve,reject)=>{
    const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{
      method:init.method, headers:Object.fromEntries(new Headers(init.headers)), signal:init.signal ?? undefined,
      agent:false,
      lookup: ((_hostname: string, options: any, cb: any)=> options?.all
        ? cb(null,[address]) : cb(null,address.address,address.family)) as any,
    },res=>{
      const chunks:Buffer[]=[]; let size=0;
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8*1024*1024){res.destroy(new Error('HTTP response exceeds size limit.'));}else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{
        const headers=new Headers();for(const [name,value] of Object.entries(res.headers)) if(value!==undefined) for(const v of Array.isArray(value)?value:[value]) headers.append(name,v);
        const status=res.statusCode ?? 500;
        resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers}));
      });
    });
    request.on('error',reject);
    if(init.body!==undefined && init.body!==null) request.write(init.body);
    request.end();
  });
}

import { createServer, request as httpRequest } from 'node:http';
import type {AddressInfo} from 'node:net';
import { HttpToolExecutor } from '../src/tools/httpToolExecutor';
import { createToolRecord } from '@multi-agent/types';
function tool(url:string,method='GET') { return {...createToolRecord({name:'safe HTTP',category:'http'}),configuration:{url,method}}; }
// Controlled transport is intentionally explicit: the production resolver still validates every hop.
test('7: real loopback listener receives no request, including mapped IPv6 and URL credentials',async()=>{
  let hits=0;const server=createServer((_req,res)=>{hits++;res.end('{}');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as AddressInfo).port;
  try {
    for(const url of [`http://127.0.0.1:${port}`,`http://[::ffff:127.0.0.1]:${port}`,`http://user:pass@127.0.0.1:${port}`]) {
      await expect(new HttpToolExecutor().execute({tool:tool(url),input:{}})).rejects.toThrow(/destination|credentials|address/i);
    }
    expect(hits).toBe(0);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('7: mixed DNS answers fail closed, rebinding uses validated pin; redirects validate each hop and do not forward bodies',async()=>{
  const fetcher=jest.fn(async()=>new Response('{}'));
  const make=(resolve:unknown,transport=fetcher)=>new (HttpToolExecutor as any)(transport,{resolve});
  await expect(make(async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}]).execute({tool:tool('https://mixed.example'),input:{}})).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  const resolve=jest.fn(async()=>[{address:'93.184.216.34',family:4}]);
  await make(resolve).execute({tool:tool('https://public.example'),input:{}});
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([expect.any(URL),expect.objectContaining({pinnedAddress:{address:'93.184.216.34',family:4},redirect:'manual'})]);
  const redirect=jest.fn(async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}}));
  await expect(make(resolve,redirect).execute({tool:tool('https://public.example'),input:{}})).rejects.toThrow();
  expect(redirect).toHaveBeenCalledTimes(1);
  const cross=jest.fn(async()=>new Response('',{status:307,headers:{location:'https://other.example'}}));
  await expect(make(resolve,cross).execute({tool:tool('https://public.example','POST'),input:{sensitive:'secret'}})).rejects.toThrow(/origin/i);
  expect(cross).toHaveBeenCalledTimes(1);
});

test('7: native connector uses the validated address after DNS rebinding; real redirect never contacts forbidden listener',async()=>{
  const http=require('node:http') as typeof import('node:http');const realRequest=http.request.bind(http);
  let allowedHits=0,forbiddenHits=0;
  const forbidden=createServer((_req,res)=>{forbiddenHits++;res.end('private');});
  await new Promise<void>(r=>forbidden.listen(0,'127.0.0.1',r));
  const forbiddenPort=(forbidden.address() as AddressInfo).port;
  const allowed=createServer((req,res)=>{allowedHits++;expect(req.headers.host).toBe('public.example');
    if(req.url==='/redirect'){res.writeHead(302,{Location:`http://127.0.0.1:${forbiddenPort}/private`});res.end();}else res.end('{"pinned":true}');});
  await new Promise<void>(r=>allowed.listen(0,'127.0.0.1',r));
  const port=(allowed.address() as AddressInfo).port;
  // A controlled socket fixture maps the validated public IP to our ephemeral
  // listener. It exercises the real native request/response and redirect path.
  const pins:string[]=[];
  const connector=jest.spyOn(http,'request').mockImplementation(((url:URL,options:any,callback:any)=>{
    options.lookup(url.hostname,{all:false},(error:Error|null,address:string)=>{expect(error).toBeNull();pins.push(address);});
    return realRequest(`http://127.0.0.1:${port}${url.pathname}`,{...options,headers:{...options.headers,Host:url.host}},callback);
  }) as any);
  let lookups=0;const resolve=async()=>{lookups++;return [{address:lookups%2===1?'93.184.216.34':'127.0.0.1',family:4}];};
  try{
    const executor=new HttpToolExecutor(undefined,{resolve});
    expect(await executor.execute({tool:tool('http://public.example/ok'),input:{}})).toEqual({status:200,body:{pinned:true}});
    expect(lookups).toBe(1);expect(pins).toEqual(['93.184.216.34']);
    lookups=0;
    await expect(executor.execute({tool:tool('http://public.example/redirect'),input:{}})).rejects.toThrow(/address/);
    expect(allowedHits).toBe(2);expect(forbiddenHits).toBe(0);expect(pins).toEqual(['93.184.216.34','93.184.216.34']);
  }finally{connector.mockRestore();await Promise.all([new Promise<void>(r=>allowed.close(()=>r())),new Promise<void>(r=>forbidden.close(()=>r()))]);}
});

test.each(['0.0.0.0','10.1.2.3','100.64.1.1','169.254.169.254','172.16.0.1','192.168.1.1','198.18.0.1','224.0.0.1','255.255.255.255','::','::1','fc00::1','fe80::1','::ffff:10.1.2.3','2001:db8::1','2002:7f00:1::'])('7: rejects reserved destination %s before transport',async(address)=>{
  const fetcher=jest.fn();const executor=new HttpToolExecutor(fetcher,{resolve:async()=>[{address,family:address.includes(':')?6:4}]});
  await expect(executor.execute({tool:tool('http://reserved.example'),input:{}})).rejects.toThrow(/address/);expect(fetcher).not.toHaveBeenCalled();
});

test('7: DNS failure and redirect cycles terminate without extra requests',async()=>{
  const fetcher=jest.fn();await expect(new HttpToolExecutor(fetcher,{resolve:async()=>{throw new Error('DNS unavailable');}}).execute({tool:tool('https://dns.example'),input:{}})).rejects.toThrow('DNS unavailable');expect(fetcher).not.toHaveBeenCalled();
  const cycle=jest.fn(async()=>new Response('',{status:302,headers:{Location:'/again'}}));
  await expect(new HttpToolExecutor(cycle,{resolve:async()=>[{address:'93.184.216.34',family:4}],maxRedirects:2}).execute({tool:tool('https://public.example/again'),input:{}})).rejects.toThrow(/limit/);expect(cycle).toHaveBeenCalledTimes(3);
});

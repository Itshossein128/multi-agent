import { createBrokerHarness, leaseRequest } from './helpers/brokerHarness';
import { createBrokerApp, StaticServiceAuth } from '../src/broker/httpApp';
import { VaultSecretStore } from '../src/broker/secretStore';
import { HttpCredentialGateway } from '../src/security/credentialGateway';
import { brokerServerConfigFromEnvironment } from '../src/broker/config';

test('tenant purge is separately authorized, retryable, and permanently blocks old and new credential delivery', async () => {
  const h=createBrokerHarness(); const lease=await h.service.issue(leaseRequest());
  const app=createBrokerApp({service:h.service,auth:new StaticServiceAuth([
    {token:'regular-service-token',name:'regular',scopes:['leases:issue']},
    {token:'tenant-purge-service-token',name:'cleanup',scopes:['tenants:purge']},
  ])});
  const request=(token:string)=>app.request('/v1/tenants/tenant-a/purge',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({tenantId:'tenant-a'})});
  expect((await request('regular-service-token')).status).toBe(403);
  expect((await request('tenant-purge-service-token')).status).toBe(200);
  expect((await request('tenant-purge-service-token')).status).toBe(200);
  await expect(h.service.consume({...leaseRequest(),leaseId:lease.leaseId})).rejects.toMatchObject({code:'tenant_inactive'});
  await expect(h.service.issue(leaseRequest())).rejects.toMatchObject({code:'tenant_inactive'});
  await expect(h.secrets.getSecret({tenantId:'tenant-a',provider:'database',alias:'main'})).rejects.toThrow();
  expect(await h.secrets.getSecret({tenantId:'tenant-b',provider:'database',alias:'main'})).toBeDefined();
  const gateway=new HttpCredentialGateway('https://broker.internal','tenant-purge-service-token',async(input,init)=>app.fetch(new Request(String(input),init)));
  await expect(gateway.purgeTenantCredentials('tenant-a')).resolves.toBeUndefined();
});

test('failed remote cleanup keeps the broker tenant blocked and succeeds on retry without deleting audit history',async()=>{
  const h=createBrokerHarness(); await h.service.issue(leaseRequest()); const before=h.audit.all().length;
  const deletion=jest.spyOn(h.secrets,'deleteTenantSecrets').mockRejectedValueOnce(new Error('Vault unavailable'));
  await expect(h.service.purgeTenantCredentials('tenant-a')).rejects.toThrow();
  await expect(h.service.issue(leaseRequest())).rejects.toMatchObject({code:'tenant_inactive'});
  await expect(h.service.purgeTenantCredentials('tenant-a')).resolves.toEqual({purged:true});
  expect(h.audit.all().length).toBeGreaterThanOrEqual(before); deletion.mockRestore();
  expect(h.audit.all()).toContainEqual(expect.objectContaining({tenantId:'tenant-a',operation:'tenant.purge.succeeded',result:'succeeded'}));
});

test('Vault tenant cleanup deletes metadata and every version only below the requested tenant', async()=>{
  const keys=new Set(['tenant-a/database/main','tenant-a/openai/team','tenant-b/database/main','_shared/openai/team']);
  const calls:string[]=[];
  const vault=new VaultSecretStore({baseUrl:'https://vault.internal',token:'fake-vault-token',fetchImpl:async(input,init)=>{
    const url=new URL(String(input));calls.push(`${init?.method} ${url.pathname}`);
    const prefix='/v1/secret/metadata/';
    if(!url.pathname.startsWith(prefix)) return {ok:false,status:400,json:async()=>({})};
    const path=url.pathname.slice(prefix.length);
    if(init?.method==='DELETE'){keys.delete(path);return {ok:true,status:204,json:async()=>({})};}
    if(init?.method==='LIST' || url.searchParams.get('list')==='true'){
      const children=new Set<string>(); for(const key of keys){if(key.startsWith(path+'/')){const rest=key.slice(path.length+1);children.add(rest.includes('/')?rest.split('/')[0]+'/':rest);}}
      return {ok:children.size>0,status:children.size?200:404,json:async()=>({data:{keys:[...children]}})};
    }
    return {ok:false,status:400,json:async()=>({})};
  }});
  await expect(vault.deleteTenantSecrets('tenant-a')).resolves.toBeUndefined();
  expect([...keys].sort()).toEqual(['_shared/openai/team','tenant-b/database/main']);
  expect(calls.filter(c=>c.startsWith('DELETE'))).toEqual(expect.arrayContaining(['DELETE /v1/secret/metadata/tenant-a/database/main','DELETE /v1/secret/metadata/tenant-a/openai/team']));
  await expect(vault.deleteTenantSecrets('_shared')).rejects.toThrow();
  await expect(vault.deleteTenantSecrets('../tenant-b')).rejects.toThrow();
});

test('environment token scopes preserve colons and default tokens cannot purge tenants', () => {
  const config = brokerServerConfigFromEnvironment({CREDENTIAL_BROKER_SERVICE_TOKENS:'regular:fake-regular,cleanup:fake-cleanup:tenants:purge,worker:fake-worker:leases:issue+leases:consume'});
  expect(config.serviceTokens.map(entry => entry.scopes)).toEqual([
    ['leases:issue','leases:consume','leases:revoke','audit:read'], ['tenants:purge'], ['leases:issue','leases:consume'],
  ]);
});

test.each([503,200])('Vault cleanup fails closed on a failed or malformed metadata listing (%s)', async status => {
  const vault = new VaultSecretStore({baseUrl:'https://vault.internal',token:'fake-vault-token',fetchImpl:async()=>({ok:status===200,status,json:async()=>({data:{keys:['../tenant-b/']}})})});
  await expect(vault.deleteTenantSecrets('tenant-a')).rejects.toMatchObject({code:'secretstore_unavailable'});
});

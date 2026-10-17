import {createBrokerHarness,leaseRequest} from './helpers/brokerHarness';
import {createBrokerApp,StaticServiceAuth} from '../src/broker/httpApp';
test('12: successful consume audit failure returns no secret, keeps lease consumed (service and mounted HTTP)',async()=>{
  const h=createBrokerHarness();
  const app=createBrokerApp({service:h.service,auth:new StaticServiceAuth([{token:'audit-regression-token',name:'test',scopes:['leases:consume']}])});
  for(const http of [false,true]) {
    const lease=await h.service.issue(leaseRequest());
    const original=h.audit.record.bind(h.audit);
    const mock=jest.spyOn(h.audit,'record').mockImplementation(async(input,now)=>{if(input.operation==='lease.consume.succeeded')throw new Error('audit unavailable');return original(input,now);});
    const input={...leaseRequest(),leaseId:lease.leaseId};
    if(http) {
      const response=await app.request(`/v1/leases/${lease.leaseId}/consume`,{method:'POST',headers:{Authorization:'Bearer audit-regression-token','Content-Type':'application/json'},body:JSON.stringify(input)});
      expect(response.status).toBe(500); expect(await response.text()).not.toContain('postgres://fake-broker-db/tenant-a');
    } else await expect(h.service.consume(input)).rejects.toMatchObject({code:'internal_error'});
    mock.mockRestore();
    await expect(h.service.consume(input)).rejects.toMatchObject({code:'lease_consumed'});
  }
});

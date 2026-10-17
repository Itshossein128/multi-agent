import { createCredentialComposition } from '../apps/server/src/composition';
import { InMemoryBudgetStore } from '../apps/server/src/budgets/budgetStore';

test('credential composition requires a separate purge identity and uses it for cleanup', async () => {
  const requests: Request[] = [];
  const fetcher = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify({purged:true}), {status:200});
  });
  const env = {CREDENTIAL_BROKER_URL:'https://broker.internal',CREDENTIAL_BROKER_ENABLED:'true',CREDENTIAL_BROKER_SERVICE_TOKEN:'fake-execution-token',CREDENTIAL_BROKER_REQUIRE_MTLS:'false'};
  try {
    const unsupported = createCredentialComposition(env);
    expect(unsupported.tenantCleanup).toBeUndefined();
    const configured = createCredentialComposition({...env,CREDENTIAL_BROKER_PURGE_TOKEN:'fake-purge-token'});
    await configured.tenantCleanup!.purgeTenantCredentials('tenant-a');
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('Authorization')).toBe('Bearer fake-purge-token');
    expect(new URL(requests[0].url).pathname).toBe('/v1/tenants/tenant-a/purge');
  } finally { fetcher.mockRestore(); }
});

test('budget cleanup removes tenant alerts as well as reservations and counters', async () => {
  const budgets = new InMemoryBudgetStore();
  for (const tenantId of ['org-a','org-b']) {
    await budgets.setBudget({tenantId,scope:'company',scopeId:tenantId,limitUsd:10,thresholdPercent:50});
    await budgets.reserve(`run-${tenantId}`,tenantId,[{scope:'company',scopeId:tenantId}],8);
    await budgets.settle(`run-${tenantId}`,8,tenantId);
  }
  expect(await budgets.alerts('org-a')).toHaveLength(1);
  budgets.purgeTenantBudgets('org-a');
  expect(await budgets.alerts('org-a')).toEqual([]);
  expect(await budgets.list('org-a')).toEqual([]);
  expect(await budgets.alerts('org-b')).toHaveLength(1);
  expect((await budgets.list('org-b'))[0].spentUsd).toBe(8);
});

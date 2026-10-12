// Existing domain-level router tests predate accounts and membership fixtures.
// They exercise resource ownership/transactions with an explicit test-only mock.
// The organization authorization, route-matrix and revocation suites explicitly
// select enforce, as do browser checks. Production defaults remain enforce.
process.env.ORG_MEMBERSHIP_ENFORCEMENT ??= 'shadow';

jest.mock('../apps/server/src/api/shared/http', () => {
  const actual = jest.requireActual('../apps/server/src/api/shared/http');
  return {
    ...actual,
    requireOrganizationContext: (...args) => {
      if (process.env.ORG_MEMBERSHIP_ENFORCEMENT === 'shadow') return async (_context, next) => next();
      return actual.requireOrganizationContext(...args);
    },
  };
});
// Enforce suites use the production middleware. Shadow authorization suites must
// explicitly jest.unmock this module; the mock cannot exist in application builds.

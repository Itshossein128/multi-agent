import { AsyncLocalStorage } from 'node:async_hooks';
import type { RunInitiatorKind } from './runOrganizationAccess';

/** Server entrypoints supply provenance here; request metadata never establishes it. */
export const runDispatchContext = new AsyncLocalStorage<Readonly<{ organizationId: string; kind: RunInitiatorKind }>>();

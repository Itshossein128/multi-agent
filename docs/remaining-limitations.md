# Remaining Limitations and Proof Boundaries

Last reviewed: 2026-09-25

This document records limitations that are still open after implementing typed contracts, runtime validation, fail-closed routing, and resumable human approval. The items below are not claims that the workflow engine is incomplete; they identify deployment work or verification that cannot be honestly completed from the current workspace alone.

## Deployment-dependent work

### Credential Broker deployment

The Credential Broker implementation and its local/fake-backed tests are present, but production deployment still requires:

- a real Vault deployment and production secret policy;
- real mTLS certificates, CA validation, hostname/SAN verification, and certificate rotation;
- deployment-specific `AuthorizationSource` and `QuotaUsageSource` wiring;
- production policy configuration for tenants, principals, runs, agents, tools, quotas, and budgets.

The standalone broker intentionally defaults to deny-all authorization until those sources are connected.

### Shared rate limiting

Broker rate limiters are process-local. A multi-instance production deployment needs a shared, atomic rate-limit store such as Redis or a database-backed equivalent, together with failure and partition policy.

### Real provider and external-system verification

No real provider call, remote mutation, clean-IP replacement, or external system action has been executed as part of repository validation. The verified tests use deterministic fake agents/tools and local infrastructure. Real-provider and production-mutation verification must remain an explicitly approved deployment exercise.

## Operational follow-up

- Complete browser/E2E coverage for failure, cancellation, task flows, and multi-browser behavior.
- Connect CI to a disposable checkout for repository build verification and artifact capture.
- Decide whether remaining legacy Langfuse/evaluation paths should be completed or removed.
- Review lifecycle cleanup and multi-device conflict handling for memory/registry data.

## Already resolved and therefore not open

- Typed node contracts and runtime boundary validation.
- Fail-closed conditional routing.
- Schema `pattern`, supported formats, logical composition, and local `$ref` validation.
- Resumable agent-produced `needs_human` results without replaying the provider call.
- Durable paused-context metadata needed for approval recovery.


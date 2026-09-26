import {
  assertValidBrokerClientEnvironment,
  brokerClientConfigFromEnvironment,
  type BrokerClientConfig,
} from "../../../src/broker/config";
import {
  credentialGatewayFromEnvironment,
  HttpCredentialGateway,
  type CredentialGateway,
} from "../../../src/security/credentialGateway";
import {
  apiProviderCredentialResolverFromEnvironment,
  NO_API_CREDENTIALS,
  type ApiProviderCredentialResolver,
} from "../../../src/security/providerCredentials";
import { workerCredentialResolverFromEnvironment, type WorkerCredentialResolver } from "../../../src/agents/runtime";
import { log } from "./logging";

/**
 * Credential composition root for the execution server.
 *
 * Owns the process-wide selection between:
 * - HttpCredentialGateway  -> external Credential Broker (production default,
 *   mandatory: production startup fails without valid broker configuration
 *   including mTLS material when CREDENTIAL_BROKER_REQUIRE_MTLS=true);
 * - EnvironmentCredentialGateway -> development/single-server only.
 *
 * Precedence when both old and new configuration exist:
 * CREDENTIAL_BROKER_* wins over TOOL_CREDENTIAL_GATEWAY_*.
 *
 * Nothing here logs configuration values — only mode booleans and, for TLS,
 * file *names* are ever surfaced.
 */

export interface CredentialComposition {
  gateway: CredentialGateway;
  workerCredentials: WorkerCredentialResolver;
  apiCredentials: ApiProviderCredentialResolver;
  mode: "broker" | "environment";
  config?: BrokerClientConfig;
  close(): void;
}

export function createCredentialComposition(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CredentialComposition {
  // Production validation happens first: throws before any gateway exists.
  const config = env.NODE_ENV === "production"
    ? assertValidBrokerClientEnvironment(env)
    : brokerClientConfigFromEnvironment(env);

  const gateway = credentialGatewayFromEnvironment(env);
  const mode = gateway instanceof HttpCredentialGateway ? "broker" : "environment";

  const workerCredentials = workerCredentialResolverFromEnvironment(env);
  const apiCredentials = env.API_CREDENTIAL_LEASED_PROVIDERS?.trim()
    ? apiProviderCredentialResolverFromEnvironment(env)
    : NO_API_CREDENTIALS;

  // Mode-only logging. Certificate file names are safe; contents and tokens are not.
  log.info("credential.compose", {
    mode,
    brokerEnabled: config.enabled,
    requireMtls: config.requireMtls,
    caFile: config.tls?.caFile.split(/[\\/]/).pop(),
    clientCertFile: config.tls?.certFile.split(/[\\/]/).pop(),
    failClosed: config.failClosed,
  });

  return {
    gateway,
    workerCredentials,
    apiCredentials,
    mode,
    config,
    close: () => undefined,
  };
}

#!/usr/bin/env node
/**
 * Applies the Credential Broker schema (leases + append-only audit) to
 * CREDENTIAL_BROKER_DATABASE_URL. Idempotent; safe to re-run.
 * Runs outside application startup, matching the repo's migration convention.
 */
require("ts-node/register");
const { Pool } = require("pg");
const { LEASE_TABLE_DDL } = require("../../src/broker/leaseStore");
const { AUDIT_TABLE_DDL } = require("../../src/broker/audit");

async function main() {
  const url = process.env.CREDENTIAL_BROKER_DATABASE_URL;
  if (!url) {
    throw new Error("CREDENTIAL_BROKER_DATABASE_URL must point to the broker's isolated database");
  }
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(LEASE_TABLE_DDL);
    await pool.query(AUDIT_TABLE_DDL);
    console.log("Credential broker migrations already current or applied");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

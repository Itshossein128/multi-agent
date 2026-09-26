import {
  ContractViolationError,
  NODE_CONTRACT_VERSION,
  NODE_OUTCOME_STATUSES,
  createResultEnvelope,
  enforcePayloadBound,
  enforceSchema,
  findUnsupportedSchemaKeywords,
  migrateNodeContract,
  parseResultEnvelope,
  validateAgainstSchema,
  validateNodeContract,
  validateRawNodeContract,
} from "@multi-agent/types";

describe("node contract schema validation", () => {
  const inputSchema = {
    type: "object",
    properties: { objective: { type: "string" }, depth: { type: "integer", minimum: 0 } },
    required: ["objective"],
    additionalProperties: false,
  };

  test("valid input passes validation", () => {
    const result = validateAgainstSchema(inputSchema, { objective: "ship it", depth: 2 });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("invalid input is rejected with stable machine-readable codes", () => {
    const missing = validateAgainstSchema(inputSchema, { depth: 1 });
    expect(missing.valid).toBe(false);
    expect(missing.issues[0]).toMatchObject({ code: "SCHEMA_REQUIRED", path: "$" });

    const wrongType = validateAgainstSchema(inputSchema, { objective: 42 });
    expect(wrongType.valid).toBe(false);
    expect(wrongType.issues[0]).toMatchObject({ code: "SCHEMA_TYPE_MISMATCH", path: "$.objective" });

    const extra = validateAgainstSchema(inputSchema, { objective: "x", sneaky: true });
    expect(extra.valid).toBe(false);
    expect(extra.issues[0]).toMatchObject({ code: "SCHEMA_ADDITIONAL_PROPERTIES", path: "$.sneaky" });
  });

  test("valid output passes validation", () => {
    const outputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    expect(validateAgainstSchema(outputSchema, { ok: true }).valid).toBe(true);
  });

  test("malformed output is rejected", () => {
    const outputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const result = validateAgainstSchema(outputSchema, { ok: "definitely" });
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe("SCHEMA_TYPE_MISMATCH");
  });

  test("schema diagnostics are sanitized and bounded", () => {
    const secret = "sk-super-secret-value-do-not-leak";
    const schema = {
      type: "object",
      properties: { note: { type: "string" }, keep: { type: "string" } },
      required: ["missing-field"],
      additionalProperties: false,
    };
    const result = validateAgainstSchema(schema, { note: 42, keep: secret, extra: secret }, { maxIssues: 2 });
    expect(result.valid).toBe(false);
    // Issue list respects the cap and is flagged as truncated.
    expect(result.issues).toHaveLength(2);
    expect(result.truncated).toBe(true);
    // Raw payload values never appear in diagnostics — only paths and types.
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("$.note");
    expect(serialized).toContain("received number");
  });

  test("supported schema keywords are enforced", () => {
    expect(findUnsupportedSchemaKeywords({ type: "object", pattern: "^x" })).toEqual([]);
    expect(findUnsupportedSchemaKeywords({ type: "object", $ref: "#/definitions/x" })).toEqual([]);
    expect(validateAgainstSchema({ type: "string", pattern: "^x", format: "email" }, "x").valid).toBe(false);
    expect(validateAgainstSchema({ type: "string", pattern: "^x", format: "email" }, "x@example.com").valid).toBe(true);
    expect(validateAgainstSchema({
      definitions: { positive: { type: "integer", minimum: 1 } },
      $ref: "#/definitions/positive",
    }, 2).valid).toBe(true);
    expect(validateAgainstSchema({ anyOf: [{ type: "string" }, { type: "integer" }] }, 2).valid).toBe(true);
    expect(validateAgainstSchema({ type: "object", unknownKeyword: true }, {}).issues[0].code).toBe("SCHEMA_UNSUPPORTED");
  });

  test("unknown contract fields are rejected instead of being silently dropped", () => {
    expect(validateRawNodeContract({ version: 1, futureMode: "strict" })).toEqual([
      expect.objectContaining({ code: "UNKNOWN_CONTRACT_FIELD", field: "futureMode" }),
    ]);
  });

  test("legacy business payloads with status success are not misread as envelopes", () => {
    expect(parseResultEnvelope({ status: "success", message: "completed" })).toEqual({ kind: "absent" });
    expect(parseResultEnvelope({ status: "success", value: { ok: true } })).toMatchObject({ kind: "valid" });
  });
});

describe("versioned contract model and migration", () => {
  test("legacy definitions without contracts stay compatible", () => {
    expect(migrateNodeContract(undefined)).toBeUndefined();
    expect(migrateNodeContract(null)).toBeUndefined();
    expect(migrateNodeContract("garbage")).toBeUndefined();
    expect(validateNodeContract(undefined)).toEqual([]);
  });

  test("contract data from older workflows migrates to the current version", () => {
    const migrated = migrateNodeContract({ inputSchema: { type: "object" } });
    expect(migrated).toEqual({ version: NODE_CONTRACT_VERSION, inputSchema: { type: "object" } });
    // Round-trips through workflow serialization.
    expect(migrateNodeContract(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  test("declaration-time validation reports stable codes", () => {
    const future = validateRawNodeContract({ version: NODE_CONTRACT_VERSION + 1 });
    expect(future.map((issue) => issue.code)).toContain("UNSUPPORTED_CONTRACT_VERSION");

    expect(validateRawNodeContract({ version: 1, outputSchema: { type: "object", pattern: "x" } })).toEqual([]);

    const badBound = validateRawNodeContract({ version: 1, maxPayloadBytes: 5 });
    expect(badBound.map((issue) => issue.code)).toContain("INVALID_PAYLOAD_BOUNDS");

    const badShape = validateRawNodeContract({ version: 1, inputSchema: "not-a-schema" });
    expect(badShape.map((issue) => issue.code)).toContain("INVALID_CONTRACT_SCHEMA");

    const badVersion = validateRawNodeContract({ version: "banana" });
    expect(badVersion.map((issue) => issue.code)).toContain("INVALID_CONTRACT_VERSION");
  });
});

describe("deterministic result envelope", () => {
  test("the taxonomy distinguishes every required outcome", () => {
    expect([...NODE_OUTCOME_STATUSES]).toEqual([
      "success", "validation_failed", "failed", "policy_rejected", "blocked", "needs_human", "unknown",
    ]);
    const envelope = createResultEnvelope("blocked", {
      error: { code: "NODE_BLOCKED", message: "stop", retryable: false },
      diagnostics: [{ code: "X", message: "y" }],
    });
    expect(envelope).toMatchObject({ contractVersion: NODE_CONTRACT_VERSION, status: "blocked" });
    expect(envelope.error?.retryable).toBe(false);
  });

  test("structured envelopes parse; arbitrary model text does not", () => {
    const parsed = parseResultEnvelope({ status: "failed", branch: "fail", error: { code: "E", message: "m" } });
    expect(parsed.kind).toBe("valid");
    if (parsed.kind === "valid") expect(parsed.envelope).toMatchObject({ status: "failed", branch: "fail" });

    // Free-form prose and domain-ish payloads are plain values, not envelopes.
    expect(parseResultEnvelope("all done, looks good!").kind).toBe("absent");
    expect(parseResultEnvelope({ status: "Agent B completed branch" }).kind).toBe("absent");
    expect(parseResultEnvelope({ result: "ok" }).kind).toBe("absent");
  });

  test("envelopes with malformed structure are rejected with diagnostics", () => {
    const parsed = parseResultEnvelope({ status: "blocked", branch: 42 });
    expect(parsed.kind).toBe("malformed");
    if (parsed.kind === "malformed") {
      expect(parsed.diagnostics[0].code).toBe("ENVELOPE_BRANCH_INVALID");
      expect(JSON.stringify(parsed.diagnostics)).not.toContain("42");
    }
  });
});

describe("typed contract violations", () => {
  test("schema enforcement throws stable codes with bounded diagnostics", () => {
    let thrown: unknown;
    try {
      enforceSchema({ type: "object", required: ["q"] }, { note: "sk-secret-should-not-appear" }, {
        code: "TOOL_INPUT_INVALID",
        phase: "tool input",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ContractViolationError);
    const violation = thrown as ContractViolationError;
    expect(violation.code).toBe("TOOL_INPUT_INVALID");
    expect(violation.message).toContain("TOOL_INPUT_INVALID");
    expect(JSON.stringify(violation.diagnostics)).not.toContain("sk-secret-should-not-appear");
    expect(violation.envelope.status).toBe("validation_failed");
  });

  test("payload bounds fail closed with a typed violation", () => {
    expect(() => enforcePayloadBound({ small: true }, undefined, { phase: "output" })).not.toThrow();
    expect(() => enforcePayloadBound({ big: "x".repeat(5_000) }, 1_024, { phase: "output" })).toThrow(/PAYLOAD_TOO_LARGE/);
  });
});

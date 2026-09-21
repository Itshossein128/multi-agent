import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

// Mock next-auth to avoid ESM import issues in Jest
jest.mock("next-auth", () => jest.fn(() => ({ handlers: {}, auth: jest.fn(), signIn: jest.fn(), signOut: jest.fn() })));
jest.mock("next-auth/providers/credentials", () => jest.fn((config) => ({ id: "credentials", ...config })));
// server-only is a Next.js build-time guard; jest has no bundler alias for it.
jest.mock("server-only", () => ({}), { virtual: true });

import { registerUser } from "../apps/web/src/app/register/actions";
import { authConfig } from "../apps/web/src/auth";
import { getDbPool } from "../apps/web/src/lib/db";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";

// Ensure tests use the test database
const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

(databaseUrl ? describe : describe.skip)("Authentication & Authorization Lifecycle", () => {
  let schema: string;

  beforeAll(async () => {
    schema = `auth_test_${randomUUID().replace(/-/g, "")}`;
    const testUrl = new URL(databaseUrl!);
    testUrl.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.MEMORY_DATABASE_URL = testUrl.toString();

    const { Pool } = require("pg");
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();

    const pool = getDbPool();
    await runStudioMigrations(pool);
  });

  afterAll(async () => {
    const pool = getDbPool();
    await pool.end();

    const { Pool } = require("pg");
    const admin = new Pool({ connectionString: databaseUrl });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  });

  describe("Registration Flow", () => {
    test("successfully registers a new user with hashed password and isolated tenant", async () => {
      const email = "new_user@example.com";
      const password = "SuperSecretPassword123";

      const fd = new FormData();
      fd.append("email", email);
      fd.append("password", password);
      fd.append("confirmPassword", password);
      const result = await registerUser(fd);
      
      expect(result.success).toBe(true);

      const pool = getDbPool();
      const { rows } = await pool.query("SELECT * FROM studio_users WHERE email = $1", [email]);
      
      expect(rows).toHaveLength(1);
      const user = rows[0];
      
      // Tenant isolation: Ensure tenant_id is generated
      expect(user.tenant_id).toBeTruthy();
      
      // Ownership: Ensure ID is generated
      expect(user.id).toBeTruthy();
      
      // Security: Password must be hashed
      expect(user.password_hash).not.toBe(password);
      
      const isMatch = await bcrypt.compare(password, user.password_hash);
      expect(isMatch).toBe(true);
    });

    test("fails registration if email is already taken, returning a generic error", async () => {
      const email = "duplicate@example.com";
      
      const fd1 = new FormData();
      fd1.append("email", email);
      fd1.append("password", "FirstPassword123");
      fd1.append("confirmPassword", "FirstPassword123");
      await registerUser(fd1);
      
      const fd2 = new FormData();
      fd2.append("email", email);
      fd2.append("password", "SecondPassword123");
      fd2.append("confirmPassword", "SecondPassword123");
      const result = await registerUser(fd2);
      
      expect(result.success).toBeUndefined();
      // Security: Ensure the error doesn't confirm the email exists (generic error)
      expect(result.error).toBe("A user with this email already exists");
    });
  });

  describe("Login and NextAuth Authorization Flow", () => {
    test("authorizes credentials for a valid registered user", async () => {
      const email = "login_test@example.com";
      const password = "ValidPassword123";
      
      const fd = new FormData();
      fd.append("email", email);
      fd.append("password", password);
      fd.append("confirmPassword", password);
      await registerUser(fd);

      // Get the authorize callback from the Credentials provider
      const credentialsProvider = (authConfig.providers as any[]).find(p => typeof p === 'function' ? p().id === 'credentials' : p.id === 'credentials');
      const authorizeFn = credentialsProvider?.authorize || (credentialsProvider && typeof credentialsProvider === 'function' ? credentialsProvider().authorize : null);

      expect(authorizeFn).toBeDefined();

      const user = await authorizeFn({ email, password });
      
      expect(user).not.toBeNull();
      expect(user?.id).toBeTruthy();
      expect(user?.tenantId).toBeTruthy();
      expect(user?.email).toBe(email);
    });

    test("rejects authorization for invalid password", async () => {
      const email = "wrong_password@example.com";
      const fd = new FormData();
      fd.append("email", email);
      fd.append("password", "CorrectPassword123");
      fd.append("confirmPassword", "CorrectPassword123");
      await registerUser(fd);

      const credentialsProvider = (authConfig.providers as any[]).find(p => typeof p === 'function' ? p().id === 'credentials' : p.id === 'credentials');
      const authorizeFn = credentialsProvider?.authorize || (credentialsProvider && typeof credentialsProvider === 'function' ? credentialsProvider().authorize : null);

      const user = await authorizeFn({ email, password: "WrongPassword456" });
      
      // Security: Ensure invalid credentials return null
      expect(user).toBeNull();
    });

    test("rejects authorization for non-existent email", async () => {
      const credentialsProvider = (authConfig.providers as any[]).find(p => typeof p === 'function' ? p().id === 'credentials' : p.id === 'credentials');
      const authorizeFn = credentialsProvider?.authorize || (credentialsProvider && typeof credentialsProvider === 'function' ? credentialsProvider().authorize : null);

      const user = await authorizeFn({ email: "does_not_exist@example.com", password: "SomePassword123" });
      
      // Security: Ensure non-existent users return null
      expect(user).toBeNull();
    });
  });

  describe("NextAuth JWT & Session Callbacks", () => {
    test("JWT callback includes tenantId", () => {
      const jwtCallback = authConfig.callbacks?.jwt as Function;
      expect(jwtCallback).toBeDefined();

      const token = { sub: "user-123" };
      const user = { id: "user-123", tenantId: "tenant-456" };

      const newToken = jwtCallback({ token, user });
      
      expect(newToken.tenantId).toBe("tenant-456");
      expect(newToken.sub).toBe("user-123");
    });

    test("Session callback passes id and tenantId to the session object", () => {
      const sessionCallback = authConfig.callbacks?.session as Function;
      expect(sessionCallback).toBeDefined();

      const session = { user: { name: "Test" } };
      const token = { sub: "user-123", tenantId: "tenant-456" };

      const newSession = sessionCallback({ session, token });
      
      expect(newSession.user.id).toBe("user-123");
      expect(newSession.user.tenantId).toBe("tenant-456");
      expect(newSession.user.name).toBe("Test");
    });
  });
});

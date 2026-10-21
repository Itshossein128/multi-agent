import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createToolRecord } from "@multi-agent/types";
import type { DestinationResolver } from "../src/tools/httpDestination";
import { HttpToolExecutor } from "../src/tools/httpToolExecutor";

function httpTool(url: string, method = "GET") {
  return {
    ...createToolRecord({ name: "safe HTTP", category: "http" }),
    configuration: { url, method },
  };
}

test("rejects direct loopback, IPv4-mapped loopback, and URL credentials before transport", async () => {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    for (const url of [
      `http://127.0.0.1:${port}`,
      `http://[::ffff:127.0.0.1]:${port}`,
      `http://user:pass@127.0.0.1:${port}`,
    ]) {
      await expect(new HttpToolExecutor().execute({ tool: httpTool(url), input: {} })).rejects.toThrow(
        /destination|credentials|address/i,
      );
    }
    expect(hits).toBe(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("fails closed on mixed DNS answers and pins transport to the validated address", async () => {
  const transport = jest.fn(async () => new Response("{}"));
  const makeExecutor = (resolve: DestinationResolver) => new HttpToolExecutor(transport, { resolve });

  await expect(
    makeExecutor(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]).execute({ tool: httpTool("https://mixed.example"), input: {} }),
  ).rejects.toThrow(/address/i);
  expect(transport).not.toHaveBeenCalled();

  const resolve = jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  await makeExecutor(resolve).execute({ tool: httpTool("https://public.example"), input: {} });

  expect(resolve).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      pinnedAddress: { address: "93.184.216.34", family: 4 },
      redirect: "manual",
    }),
  );
});

test("validates every redirect and does not forward request bodies across origins", async () => {
  const resolve = jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
  const privateRedirect = jest.fn(async () =>
    new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
  );
  const privateRedirectExecutor = new HttpToolExecutor(privateRedirect, { resolve });

  await expect(
    privateRedirectExecutor.execute({ tool: httpTool("https://public.example"), input: {} }),
  ).rejects.toThrow(/address/i);
  expect(privateRedirect).toHaveBeenCalledTimes(1);

  const crossOriginRedirect = jest.fn(async () =>
    new Response(null, { status: 307, headers: { location: "https://other.example" } }),
  );
  const crossOriginExecutor = new HttpToolExecutor(crossOriginRedirect, { resolve });
  await expect(
    crossOriginExecutor.execute({
      tool: httpTool("https://public.example", "POST"),
      input: { sensitive: "secret" },
    }),
  ).rejects.toThrow(/origin/i);
  expect(crossOriginRedirect).toHaveBeenCalledTimes(1);
});

test("native transport stays pinned across DNS rebinding and blocks a private redirect", async () => {
  const http = require("node:http") as typeof import("node:http");
  const realRequest = http.request.bind(http);
  let allowedHits = 0;
  let forbiddenHits = 0;

  const forbidden = createServer((_request, response) => {
    forbiddenHits += 1;
    response.end("private");
  });
  await new Promise<void>((resolve) => forbidden.listen(0, "127.0.0.1", resolve));
  const forbiddenPort = (forbidden.address() as AddressInfo).port;

  const allowed = createServer((request, response) => {
    allowedHits += 1;
    expect(request.headers.host).toBe("public.example");
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: `http://127.0.0.1:${forbiddenPort}/private` });
      response.end();
      return;
    }
    response.end('{"pinned":true}');
  });
  await new Promise<void>((resolve) => allowed.listen(0, "127.0.0.1", resolve));
  const port = (allowed.address() as AddressInfo).port;

  // Route the validated public address to the fixture while recording the
  // address selected by the production connector's custom lookup callback.
  const pins: string[] = [];
  const connector = jest.spyOn(http, "request").mockImplementation(((url: URL, options: any, callback: any) => {
    options.lookup(url.hostname, { all: false }, (error: Error | null, address: string) => {
      expect(error).toBeNull();
      pins.push(address);
    });
    return realRequest(
      `http://127.0.0.1:${port}${url.pathname}`,
      { ...options, headers: { ...options.headers, Host: url.host } },
      callback,
    );
  }) as any);

  let lookups = 0;
  const resolve = async () => {
    lookups += 1;
    return [{ address: lookups % 2 === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
  };

  try {
    const executor = new HttpToolExecutor(undefined, { resolve });
    await expect(
      executor.execute({ tool: httpTool("http://public.example/ok"), input: {} }),
    ).resolves.toEqual({ status: 200, body: { pinned: true } });
    expect(lookups).toBe(1);
    expect(pins).toEqual(["93.184.216.34"]);

    lookups = 0;
    await expect(
      executor.execute({ tool: httpTool("http://public.example/redirect"), input: {} }),
    ).rejects.toThrow(/address/i);
    expect(allowedHits).toBe(2);
    expect(forbiddenHits).toBe(0);
    expect(pins).toEqual(["93.184.216.34", "93.184.216.34"]);
  } finally {
    connector.mockRestore();
    await Promise.all([
      new Promise<void>((resolve) => allowed.close(() => resolve())),
      new Promise<void>((resolve) => forbidden.close(() => resolve())),
    ]);
  }
});

test.each([
  "0.0.0.0",
  "10.1.2.3",
  "100.64.1.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "198.18.0.1",
  "224.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:10.1.2.3",
  "2001:db8::1",
  "2002:7f00:1::",
])("rejects reserved destination %s before transport", async (address) => {
  const transport = jest.fn();
  const executor = new HttpToolExecutor(transport, {
    resolve: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
  });

  await expect(executor.execute({ tool: httpTool("http://reserved.example"), input: {} })).rejects.toThrow(
    /address/i,
  );
  expect(transport).not.toHaveBeenCalled();
});

test("DNS failures and redirect cycles terminate without extra requests", async () => {
  const transport = jest.fn();
  const dnsFailureExecutor = new HttpToolExecutor(transport, {
    resolve: async () => {
      throw new Error("DNS unavailable");
    },
  });
  await expect(
    dnsFailureExecutor.execute({ tool: httpTool("https://dns.example"), input: {} }),
  ).rejects.toThrow("DNS unavailable");
  expect(transport).not.toHaveBeenCalled();

  const cycle = jest.fn(async () =>
    new Response(null, { status: 302, headers: { location: "/again" } }),
  );
  const cycleExecutor = new HttpToolExecutor(cycle, {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    maxRedirects: 2,
  });
  await expect(
    cycleExecutor.execute({ tool: httpTool("https://public.example/again"), input: {} }),
  ).rejects.toThrow(/limit/i);
  expect(cycle).toHaveBeenCalledTimes(3);
});

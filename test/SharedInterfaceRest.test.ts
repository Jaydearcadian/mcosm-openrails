import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import { registerSharedInterfaceRoutes } from "../server/shared-interface";
import { app as serverApp } from "../server/index";

type Handler = (req: any, res: any, next?: () => void) => void;

function routeTable() {
  const routes = new Map<string, Handler[]>();
  const app = {
    get(path: string, ...handlers: Handler[]) {
      routes.set(`GET ${path}`, handlers);
    },
    post(path: string, ...handlers: Handler[]) {
      routes.set(`POST ${path}`, handlers);
    },
  };
  registerSharedInterfaceRoutes(app as any);
  return routes;
}

function invokeRoute(routes: Map<string, Handler[]>, key: string, req: any, res: any): void {
  const handlers = routes.get(key) ?? [];
  let index = 0;
  const next = () => handlers[index++]?.(req, res, next);
  next();
}

function response() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

const network = { networkId: "arc-testnet", chainId: "5042002" };
const workspaceRegister = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../interface/fixtures/workspace-register.json"),
  "utf8",
));
const context = {
  executionProfile: "direct-wallet-authorized",
  subject: {
    actorRef: { type: "Actor", id: "actor:rest-test", network },
    role: "observer",
  },
  network,
  provenance: {
    authority: "rest-test",
    evidenceLevel: "configuration-only",
    observedAt: "2099-08-03T00:00:00Z",
    source: "configuration",
  },
  createdAt: "2099-08-03T00:00:00Z",
};

describe("Shared Interface REST boundary", () => {
  const routes = routeTable();

  it("is registered on the production Express app", () => {
    const paths = ((serverApp as any)._router?.stack ?? [])
      .filter((layer: any) => layer.route)
      .map((layer: any) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    expect(paths).to.include.members([
      "GET /api/v1/interface/capabilities",
      "POST /api/v1/interface/prepare",
      "POST /api/v1/interface/validate",
      "POST /api/v1/interface/verify",
      "GET /api/v1/interface/read",
      "GET /api/v1/interface/read/:type/:id",
      "GET /api/interface/capabilities",
      "POST /api/interface/prepare",
      "POST /api/interface/validate",
      "POST /api/interface/verify",
      "GET /api/interface/read",
      "GET /api/interface/read/:type/:id",
      "GET /api/interface/1.2.0/capabilities",
      "POST /api/interface/1.2.0/prepare",
      "POST /api/interface/1.2.0/validate",
      "POST /api/interface/1.2.0/verify",
      "GET /api/interface/1.2.0/read",
      "GET /api/interface/1.2.0/read/:type/:id",
    ]);
  });

  it("reports a safe surface and credential-gated Circle capability", () => {
    const res = response();
    invokeRoute(routes, "GET /api/v1/interface/capabilities", {}, res);
    expect(res.statusCode).to.equal(200);
    expect((res.body as any).safeSurface.canSign).to.equal(false);
    expect((res.body as any).safeSurface.canBroadcast).to.equal(false);
    expect((res.body as any).circleGasStation.status).to.equal("UNAVAILABLE");
    expect((res.body as any).circleGasStation.liveExecutionProven).to.equal(false);
  });

  it("serves the explicit 1.2.0 compatibility alias", () => {
    const res = response();
    invokeRoute(routes, "GET /api/interface/1.2.0/capabilities", {}, res);
    expect(res.statusCode).to.equal(200);
    expect((res.body as any).interfaceVersion).to.equal("1.2.0");
  });

  it("prepares, validates, and verifies without broadcasting", () => {
    const prepared = response();
    invokeRoute(routes, "POST /api/v1/interface/prepare", {
      body: { operationId: "network.get", data: { networkId: "arc-testnet" }, context },
    }, prepared);
    expect(prepared.statusCode).to.equal(200);
    expect((prepared.body as any).broadcasted).to.equal(false);
    expect((prepared.body as any).request.operationId).to.equal("network.get");

    const envelope = (prepared.body as any).request;
    const validated = response();
    invokeRoute(routes, "POST /api/v1/interface/validate", {
      body: { operationId: "network.get", direction: "request", envelope },
    }, validated);
    expect((validated.body as any).valid).to.equal(true);

    const verified = response();
    invokeRoute(routes, "POST /api/v1/interface/verify", {
      body: { operationId: "network.get", direction: "request", envelope },
    }, verified);
    expect((verified.body as any).valid).to.equal(true);
    expect((verified.body as any).financialSuccess).to.equal(false);
    expect((verified.body as any).broadcasted).to.equal(false);

    const requiredRecord = response();
    invokeRoute(routes, "POST /api/v1/interface/verify", {
      body: {
        pact: {
          canonicalRecordPolicy: {
            mode: "required",
            exposure: "encrypted",
            signatureRequirement: "bilateral-typed-actor-signatures",
          },
        },
      },
    }, requiredRecord);
    expect(requiredRecord.statusCode).to.equal(400);
    expect((requiredRecord.body as any).valid).to.equal(false);
  });

  it("rejects custody fields and leaves indexer reads replaceable", () => {
    const rejected = response();
    invokeRoute(routes, "POST /api/v1/interface/prepare", {
      body: { operationId: "network.get", data: { networkId: "arc-testnet" }, context, privateKey: "rejected" },
    }, rejected);
    expect(rejected.statusCode).to.equal(400);
    expect((rejected.body as any).valid).to.equal(false);

    const read = response();
    invokeRoute(routes, "GET /api/v1/interface/read/:type/:id", { params: { type: "CanonicalRecord", id: "record:missing" }, query: {} }, read);
    expect(read.statusCode).to.equal(503);
    expect((read.body as any).capabilityStatus).to.equal("UNAVAILABLE");
  });

  it("rejects oversized JSON bodies before interface processing", () => {
    const rejected = response();
    invokeRoute(routes, "POST /api/v1/interface/prepare", {
      body: { operationId: "network.get", data: { value: "x".repeat(64 * 1024) }, context },
    }, rejected);
    expect(rejected.statusCode).to.equal(400);
    expect((rejected.body as any).error).to.include("byte interface limit");
  });

  it("derives signed-runtime authority and rejects forged REST context", () => {
    const prepared = response();
    invokeRoute(routes, "POST /api/v1/interface/prepare", {
      ip: "shared-interface-runtime-valid",
      body: { operationId: "workspace.register", data: workspaceRegister },
    }, prepared);
    expect(prepared.statusCode).to.equal(200);
    expect((prepared.body as any).request.executionProfile).to.equal("delegated-runtime");
    expect((prepared.body as any).request.subject.walletAddress).to.equal(workspaceRegister.signatureBinding.signer);
    expect((prepared.body as any).request.network).to.deep.equal(network);
    expect((prepared.body as any).request.provenance.evidenceLevel).to.equal("configuration-only");
    expect((prepared.body as any).request.createdAt).to.equal(workspaceRegister.signatureBinding.issuedAt);

    const rejected = response();
    invokeRoute(routes, "POST /api/v1/interface/prepare", {
      ip: "shared-interface-runtime-forged",
      body: {
        operationId: "workspace.register",
        data: workspaceRegister,
        context: {
          subject: { actorRef: { type: "Actor", id: "actor:attacker" }, role: "owner" },
          network: { networkId: "attacker-network", chainId: "1" },
          provenance: {
            source: "runtime-evaluation",
            authority: "attacker",
            evidenceLevel: "runtime-observed",
            observedAt: "2000-01-01T00:00:00Z",
          },
          createdAt: "2000-01-01T00:00:00Z",
        },
      },
    }, rejected);
    expect(rejected.statusCode).to.equal(400);
    expect((rejected.body as any).error).to.include("must exactly match the SDK-derived value");
  });

  it("rate limits repeated interface POST requests", () => {
    let lastResponse = response();
    for (let index = 0; index < 21; index += 1) {
      lastResponse = response();
      invokeRoute(routes, "POST /api/v1/interface/prepare", {
        ip: "shared-interface-rate-test",
        body: { operationId: "network.get", data: { networkId: "arc-testnet" }, context },
      }, lastResponse);
    }
    expect(lastResponse.statusCode).to.equal(429);
    expect((lastResponse.body as any).error).to.include("Rate limit exceeded");
  });
});

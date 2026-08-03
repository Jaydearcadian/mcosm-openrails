import { expect } from "chai";
import { registerSharedInterfaceRoutes } from "../server/shared-interface";
import { app as serverApp } from "../server/index";

type Handler = (req: any, res: any) => void;

function routeTable() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path: string, handler: Handler) {
      routes.set(`POST ${path}`, handler);
    },
  };
  registerSharedInterfaceRoutes(app as any);
  return routes;
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
      "GET /api/interface/capabilities",
      "POST /api/interface/prepare",
      "POST /api/interface/validate",
      "POST /api/interface/verify",
      "GET /api/interface/read",
      "GET /api/interface/read/:type/:id",
    ]);
  });

  it("reports a safe surface and credential-gated Circle capability", () => {
    const res = response();
    routes.get("GET /api/interface/capabilities")?.({} as any, res);
    expect(res.statusCode).to.equal(200);
    expect((res.body as any).safeSurface.canSign).to.equal(false);
    expect((res.body as any).safeSurface.canBroadcast).to.equal(false);
    expect((res.body as any).circleGasStation.status).to.equal("UNAVAILABLE");
    expect((res.body as any).circleGasStation.liveExecutionProven).to.equal(false);
  });

  it("prepares, validates, and verifies without broadcasting", () => {
    const prepared = response();
    routes.get("POST /api/interface/prepare")?.({
      body: { operationId: "network.get", data: { networkId: "arc-testnet" }, context },
    } as any, prepared);
    expect(prepared.statusCode).to.equal(200);
    expect((prepared.body as any).broadcasted).to.equal(false);
    expect((prepared.body as any).request.operationId).to.equal("network.get");

    const envelope = (prepared.body as any).request;
    const validated = response();
    routes.get("POST /api/interface/validate")?.({
      body: { operationId: "network.get", direction: "request", envelope },
    } as any, validated);
    expect((validated.body as any).valid).to.equal(true);

    const verified = response();
    routes.get("POST /api/interface/verify")?.({
      body: { operationId: "network.get", direction: "request", envelope },
    } as any, verified);
    expect((verified.body as any).valid).to.equal(true);
    expect((verified.body as any).financialSuccess).to.equal(false);
    expect((verified.body as any).broadcasted).to.equal(false);

    const requiredRecord = response();
    routes.get("POST /api/interface/verify")?.({
      body: {
        pact: {
          canonicalRecordPolicy: {
            mode: "required",
            exposure: "encrypted",
            signatureRequirement: "bilateral-typed-actor-signatures",
          },
        },
      },
    } as any, requiredRecord);
    expect(requiredRecord.statusCode).to.equal(400);
    expect((requiredRecord.body as any).valid).to.equal(false);
  });

  it("rejects custody fields and leaves indexer reads replaceable", () => {
    const rejected = response();
    routes.get("POST /api/interface/prepare")?.({
      body: { operationId: "network.get", data: { networkId: "arc-testnet" }, context, privateKey: "rejected" },
    } as any, rejected);
    expect(rejected.statusCode).to.equal(400);
    expect((rejected.body as any).valid).to.equal(false);

    const read = response();
    routes.get("GET /api/interface/read/:type/:id")?.({ params: { type: "CanonicalRecord", id: "record:missing" }, query: {} } as any, read);
    expect(read.statusCode).to.equal(503);
    expect((read.body as any).capabilityStatus).to.equal("UNAVAILABLE");
  });
});

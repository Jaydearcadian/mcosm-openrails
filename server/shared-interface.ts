import type { Express, Request, Response } from "express";
import {
  ARC_TESTNET_MANIFEST,
  assertCanonicalRecordPolicy,
  canonicalRecordCapabilityDeclaration,
  CircleGasStationAdapter,
  createOperationRequest,
  validateOperationRequest,
  validateOperationResponse,
  verifyCanonicalRecord,
  type CanonicalRecord,
  type CanonicalRecordPolicy,
  type Pact,
} from "../sdk/src/index";

const ARC_NETWORK = { networkId: "arc-testnet", chainId: "5042002" } as const;
const circleGasStation = new CircleGasStationAdapter({ credentialsPresent: false });

function rejectCustodyFields(value: unknown, path = "body"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectCustodyFields(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/private.?key|seed.?phrase|mnemonic|secret.?key|signer.?key/i.test(key)) {
      throw new Error(`${path}.${key} is not accepted by the safe interface surface`);
    }
    rejectCustodyFields(child, `${path}.${key}`);
  }
}

function bodyRecord(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new Error("JSON object body required");
  }
  return req.body as Record<string, unknown>;
}

function sendError(res: Response, error: unknown, status = 400): void {
  res.status(status).json({
    valid: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function readInterfaceObject(req: Request, res: Response): void {
  const type = String(req.params.type ?? req.query.type ?? "");
  const id = String(req.params.id ?? req.query.id ?? "");
  if (type === "NetworkManifest" || type === "network") {
    if (id && id !== ARC_NETWORK.networkId) return void res.status(404).json({ error: "Network manifest not found" });
    return void res.json({ object: ARC_TESTNET_MANIFEST, source: "shipped-manifest" });
  }
  if (type === "CapabilityDeclaration" || type === "capabilities") {
    return void res.json({
      object: { interfaceVersion: ARC_TESTNET_MANIFEST.interfaceVersion, capabilities: ARC_TESTNET_MANIFEST.capabilities },
      source: "shipped-manifest",
    });
  }
  return void res.status(503).json({
    error: "Replaceable indexer read is unavailable",
    type,
    id: id || null,
    capabilityStatus: "UNAVAILABLE",
    financialEffect: "NONE",
  });
}

/** Register the Shared Interface safe REST boundary. It never signs or broadcasts. */
export function registerSharedInterfaceRoutes(app: Express): void {
  app.get("/api/interface/capabilities", (_req, res) => {
    res.json({
      interfaceVersion: ARC_TESTNET_MANIFEST.interfaceVersion,
      network: ARC_NETWORK,
      capabilities: ARC_TESTNET_MANIFEST.capabilities,
      safeSurface: {
        signs: false,
        createsSigners: false,
        broadcasts: false,
        canRead: true,
        canPrepare: true,
        canValidate: true,
        canVerify: true,
        canSign: false,
        canBroadcast: false,
        canRelay: false,
        canonicalRecords: "pact-declared-and-optional",
      },
      circleGasStation: circleGasStation.capability(),
      canonicalRecord: canonicalRecordCapabilityDeclaration(),
    });
  });

  app.post("/api/interface/prepare", (req, res) => {
    try {
      const body = bodyRecord(req);
      rejectCustodyFields(body);
      const operationId = String(body.operationId ?? "");
      if (!operationId) throw new Error("operationId is required");
      const context = body.context;
      if (!context || typeof context !== "object" || Array.isArray(context)) throw new Error("context is required");
      const data = body.data;
      const request = createOperationRequest(operationId, data as never, context as never);
      res.status(200).json({ valid: true, broadcasted: false, request });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/interface/validate", (req, res) => {
    try {
      const body = bodyRecord(req);
      rejectCustodyFields(body);
      const operationId = String(body.operationId ?? "");
      const direction = body.direction === "response" ? "response" : "request";
      const envelope = body.envelope;
      const result = direction === "response"
        ? validateOperationResponse(operationId, envelope)
        : validateOperationRequest(operationId, envelope);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/interface/verify", (req, res) => {
    try {
      const body = bodyRecord(req);
      rejectCustodyFields(body);
      let operation: ReturnType<typeof validateOperationResponse> | ReturnType<typeof validateOperationRequest> | undefined;
      if (body.operationId && body.envelope !== undefined) {
        operation = body.direction === "request"
          ? validateOperationRequest(String(body.operationId), body.envelope)
          : validateOperationResponse(String(body.operationId), body.envelope);
      }

      const policy = (body.policy ?? (
        body.pact && typeof body.pact === "object"
          ? (body.pact as Partial<Pact>).canonicalRecordPolicy
          : undefined
      )) as CanonicalRecordPolicy | undefined;
      let canonicalRecord: ReturnType<typeof verifyCanonicalRecord> | undefined;
      if (body.record !== undefined) {
        canonicalRecord = verifyCanonicalRecord(body.record as CanonicalRecord, policy);
      } else if (policy?.mode === "required") {
        throw new Error("Pact requires a Canonical Record");
      }

      res.json({
        valid: (operation?.valid ?? true) && (canonicalRecord?.valid ?? true),
        financialSuccess: false,
        operation,
        canonicalRecord,
        broadcasted: false,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/interface/read", readInterfaceObject);
  app.get("/api/interface/read/:type/:id", readInterfaceObject);
}

export function validatePactCanonicalRecordPolicy(pact: Pact, record?: CanonicalRecord): CanonicalRecord | undefined {
  return assertCanonicalRecordPolicy(pact, record);
}

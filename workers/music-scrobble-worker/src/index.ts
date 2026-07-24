import { openListeningSession } from "./openSession";
import { authorized } from "../../shared/auth";
import {
  getSession,
  heartbeatSession,
  SessionLifecycleError,
  startSession,
  stopSession,
} from "./sessionLifecycle";

export interface Env {
  MUSICBRAINZ_REGISTRY: KVNamespace;
  STREAM_DB: D1Database;
  ARC_RPC_URL: string;
  ARC_CHAIN_ID: string;
  OPENRAILS_HUB_ADDRESS: string;
  ARC_USDC_ADDRESS: string;
  WEBHOOK_SECRET?: string;
  MUSIC_SIDECAR_RELAYER_KEY?: string;
}

interface ScrobblePayload {
  event?: string;
  track?: {
    mbid?: string;
    artist?: string;
    title?: string;
  };
  paycardId?: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OpenRails-Webhook-Secret",
    },
  });
}

function isBytes32Hex(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function lifecycleError(error: SessionLifecycleError): Response {
  const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 422;
  return jsonResponse({ error: error.message, code: error.code }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OpenRails-Webhook-Secret",
        },
      });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/artist/") && request.method === "PUT") {
        if (!authorized(request, env.WEBHOOK_SECRET, "X-OpenRails-Webhook-Secret")) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        const mbid = url.pathname.slice("/artist/".length);
        if (!mbid) return jsonResponse({ error: "Missing mbid" }, 400);
        const body = (await request.json().catch(() => null)) as { wallet?: string } | null;
        if (!body?.wallet || !isEvmAddress(body.wallet)) {
          return jsonResponse({ error: "Invalid or missing wallet address" }, 400);
        }
        await env.MUSICBRAINZ_REGISTRY.put(mbid, body.wallet.toLowerCase());
        return jsonResponse({ mbid, wallet: body.wallet.toLowerCase() });
      }

      if (url.pathname === "/session/open" && request.method === "POST") {
        if (!authorized(request, env.WEBHOOK_SECRET, "X-OpenRails-Webhook-Secret")) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        const body = (await request.json().catch(() => null)) as {
          sessionId?: string;
          listenerAddress?: string;
          artistMbid?: string;
          budgetUsdc?: string;
          velocityPerSecond?: string;
          lifespanSeconds?: string;
          envelopeToken?: string;
        } | null;

        if (!body?.sessionId || !body.listenerAddress || !body.artistMbid) {
          return jsonResponse({ error: "Missing sessionId, listenerAddress or artistMbid" }, 400);
        }
        if (!isEvmAddress(body.listenerAddress)) {
          return jsonResponse({ error: "Invalid listenerAddress" }, 400);
        }

        const artistWallet = await env.MUSICBRAINZ_REGISTRY.get(body.artistMbid);
        if (!artistWallet) {
          return jsonResponse({ error: `Artist MBID '${body.artistMbid}' is not registered.` }, 404);
        }
        if (!env.MUSIC_SIDECAR_RELAYER_KEY) {
          return jsonResponse({ error: "Relayer secret key is not configured" }, 503);
        }

        const budget = BigInt(body.budgetUsdc ?? "5000000");
        const velocity = BigInt(body.velocityPerSecond ?? "1000");
        const existing = await getSession(env.STREAM_DB, body.sessionId);
        if (existing) return jsonResponse({ session: existing, idempotent: true });

        const result = await openListeningSession({
          hubAddress: env.OPENRAILS_HUB_ADDRESS,
          rpcUrl: env.ARC_RPC_URL,
          relayerPrivateKey: env.MUSIC_SIDECAR_RELAYER_KEY,
          listenerAddress: body.listenerAddress,
          artistWallet,
          budgetUsdcBaseUnits: budget,
          velocityPerSecond: velocity,
          lifespanSeconds: BigInt(body.lifespanSeconds ?? "3600"),
          envelopeToken: body.envelopeToken,
        });

        const timestamp = Math.floor(Date.now() / 1000);
        const session = await startSession(env.STREAM_DB, {
          sessionId: body.sessionId,
          paycardId: result.paycardId,
          listenerAddress: body.listenerAddress,
          artistMbid: body.artistMbid,
          artistWallet,
          budgetBaseUnits: budget,
          velocityPerSecond: velocity,
          timestamp,
        });
        return jsonResponse({ session, settlement: result }, 201);
      }

      const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/);
      if (sessionMatch && request.method === "GET") {
        const session = await getSession(env.STREAM_DB, decodeURIComponent(sessionMatch[1]));
        return session ? jsonResponse({ session }) : jsonResponse({ error: "Session not found" }, 404);
      }

      const heartbeatMatch = url.pathname.match(/^\/session\/([^/]+)\/heartbeat$/);
      if (heartbeatMatch && request.method === "POST") {
        if (!authorized(request, env.WEBHOOK_SECRET, "X-OpenRails-Webhook-Secret")) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        const body = (await request.json().catch(() => null)) as { timestamp?: number } | null;
        const timestamp = body?.timestamp ?? Math.floor(Date.now() / 1000);
        const session = await heartbeatSession(env.STREAM_DB, decodeURIComponent(heartbeatMatch[1]), timestamp);
        return jsonResponse({ session });
      }

      const stopMatch = url.pathname.match(/^\/session\/([^/]+)\/stop$/);
      if (stopMatch && request.method === "POST") {
        if (!authorized(request, env.WEBHOOK_SECRET, "X-OpenRails-Webhook-Secret")) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
        const body = (await request.json().catch(() => null)) as { timestamp?: number } | null;
        const timestamp = body?.timestamp ?? Math.floor(Date.now() / 1000);
        const session = await stopSession(env.STREAM_DB, decodeURIComponent(stopMatch[1]), timestamp);
        return jsonResponse({ session });
      }

      if (url.pathname === "/webhook/scrobble" && request.method === "POST") {
        if (!env.WEBHOOK_SECRET) return jsonResponse({ error: "Webhook secret is not configured" }, 503);
        if (!authorized(request, env.WEBHOOK_SECRET, "X-OpenRails-Webhook-Secret")) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }

        const payload = (await request.json()) as ScrobblePayload;
        const mbid = payload.track?.mbid;
        const paycardId = payload.paycardId;
        const artistName = payload.track?.artist ?? "Unknown Artist";
        if (!mbid) return jsonResponse({ error: "Missing artist MusicBrainz ID (mbid)" }, 400);
        if (!paycardId) return jsonResponse({ error: "Missing OpenRails paycardId" }, 400);
        if (!isBytes32Hex(paycardId)) {
          return jsonResponse({ error: "Invalid OpenRails paycardId; expected bytes32 hex" }, 400);
        }

        const artistWallet = await env.MUSICBRAINZ_REGISTRY.get(mbid);
        if (!artistWallet) {
          return jsonResponse({ error: `Artist '${artistName}' (MBID: ${mbid}) is not registered.` }, 404);
        }
        if (!isEvmAddress(artistWallet)) {
          return jsonResponse({ error: "Registered artist wallet is not a valid EVM address" }, 502);
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const sourceEventId = payload.event?.trim() || null;
        await env.STREAM_DB.prepare(
          "INSERT OR IGNORE INTO plays (source_event_id, paycard_id, artist_mbid, artist_wallet, timestamp, settled, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
        )
          .bind(sourceEventId, paycardId, mbid, artistWallet, timestamp, timestamp)
          .run();

        return jsonResponse({
          success: true,
          message: "Scrobble royalty logged successfully",
          details: { artist: artistName, mbid, wallet: artistWallet, paycardId, sourceEventId },
        });
      }

      return jsonResponse({ error: "Not Found" }, 404);
    } catch (err) {
      if (err instanceof SessionLifecycleError) return lifecycleError(err);
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
};

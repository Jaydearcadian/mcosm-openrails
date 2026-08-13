/**
 * OpenRails Docs content. Restructured onto the approved Documentation
 * Architecture IA (Welcome / SDK & Toolkit / Integration Patterns / Protocol
 * Reference). Chain IDs, addresses, endpoints, and code samples are real project
 * facts. Do not paraphrase them. Code examples match the real exported SDK/worker
 * signatures (sdk/src/adapters/circle.ts, sdk/src/gateway.ts, the workers/).
 */

const H = "https://openrails-indexer-worker.microcosm.workers.dev";

export type Block =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "code"; lang: string; code: string }
  | { kind: "callout"; variant: "note" | "warn"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "kv"; rows: { k: string; v: string }[] }
  | { kind: "steps"; items: { n: string; title: string; body: string }[] };

export type DocPage = {
  eyebrow: string;
  title: string;
  subtitle: string;
  blocks: Block[];
};

export const h2 = (text: string): Block => ({ kind: "h2", text });
export const h3 = (text: string): Block => ({ kind: "h3", text });
export const p = (text: string): Block => ({ kind: "p", text });
export const code = (lang: string, codeStr: string): Block => ({ kind: "code", lang, code: codeStr });
export const list = (items: string[]): Block => ({ kind: "list", items });
export const kv = (rows: { k: string; v: string }[]): Block => ({ kind: "kv", rows });
export const steps = (items: { n: string; title: string; body: string }[]): Block => ({ kind: "steps", items });
export const callout = (variant: "note" | "warn", text: string): Block => ({ kind: "callout", variant, text });

// Linear reading order (drives prev/next). Mirrors the nav grouping below.
export const ORDER = [
  "quickstart",
  "lifecycle",
  "payments",
  "concepts",
  "sdk",
  "sdk-wallet",
  "sdk-gateway",
  "circle",
  "cli",
  "integrate",
  "x402",
  "mcp",
  "sidecar",
  "keepers",
  "cross-chain",
  "onchain",
  "api",
  "relay",
] as const;

export const NAV_GROUPS: { label: string; items: [string, string][] }[] = [
  {
    label: "Welcome",
    items: [
      ["quickstart", "Quickstart"],
      ["lifecycle", "Verifiable lifecycle"],
      ["payments", "Payment models"],
      ["concepts", "Core concepts"],
    ],
  },
  {
    label: "SDK & Toolkit",
    items: [
      ["sdk", "SDK reference"],
      ["sdk-wallet", "Wallet abstraction"],
      ["sdk-gateway", "Gateway funding"],
      ["circle", "Circle integrations"],
      ["cli", "CLI reference"],
    ],
  },
  {
    label: "Integration Patterns",
    items: [
      ["integrate", "Payment links"],
      ["x402", "x402 gated APIs"],
      ["mcp", "MCP server (agents)"],
      ["sidecar", "MusicBrainz sidecar"],
      ["keepers", "Reconciliation keepers"],
      ["cross-chain", "Cross-chain funding"],
    ],
  },
  {
    label: "Protocol Reference",
    items: [
      ["onchain", "Contracts & onchain facts"],
      ["api", "REST / indexer API"],
      ["relay", "Faucet & gasless relay"],
    ],
  },
];

export const DOCS: Record<string, DocPage> = {
  quickstart: {
    eyebrow: "Welcome",
    title: "Quickstart",
    subtitle:
      "Install the toolkit, fund an Arc testnet wallet, authorize a bounded payment, and verify the resulting transaction and Vault state.",
    blocks: [
      steps([
        { n: "1", title: "Install the Toolkit", body: "Deploy our unified SDK and CLI package with a single command. Out-of-the-box configurations for the Arc testnet are pre-wired." },
        { n: "2", title: "Request Testnet USDC", body: "Use the rate-limited faucet to provision testnet USDC, which is also used for Arc transaction fees." },
        { n: "3", title: "Launch a Payment Stream", body: "Authorize exact allocation, rate, duration, recipient, and replay-protection terms before submitting to Arc." },
        { n: "4", title: "Verify Settlement", body: "Check the Arc transaction receipt and live Vault state. Use the indexer only as a discoverable projection." },
      ]),
      h2("1 · Install the SDK & CLI"),
      code("bash", "npm i -g openrails-sdk"),
      h2("2 · Request Testnet Funds"),
      p("Our developer faucet provides a public, CORS-enabled gateway to claim testnet gas and USDC. Built with rate-limiting and abuse resistance, it skips already-provisioned addresses to ensure fair access."),
      code(
        "bash",
        'curl -X POST https://openrails-faucet-worker.microcosm.workers.dev/fund \\\n  -H "content-type: application/json" \\\n  -d \'{"address":"0xYourWallet"}\'',
      ),
      h2("3 · Stream Value with a Single Command"),
      p("All parameters following --recipient are cryptographically bound by the signature. The Hub rejects altered terms and limits the Vault to the signed allocation."),
      code(
        "bash",
        "openrails pay-stream \\\n  --recipient 0x… \\\n  --total-allocation-pool 10000 \\\n  --flow-velocity-per-second 1 \\\n  --lifespan-seconds 3600 \\\n  --execute",
      ),
      callout(
        "note",
        "Live Sandbox Environment: These commands execute live on the Arc testnet. While streams are fully functional, open, settle, and refund on-chain, please treat this environment as early and unaudited. Use test funds only.",
      ),
    ],
  },
  lifecycle: {
    eyebrow: "Welcome",
    title: "Verifiable lifecycle",
    subtitle: "OpenRails connects operating context, bounded authority, accepted terms, evidence, value movement, and canonical settlement records without treating them as the same kind of state.",
    blocks: [
      h2("The lifecycle"),
      steps([
        { n: "1", title: "Initialize a Workspace", body: "Record the durable operating context, its owner, participants, applications, and agents. A Workspace does not custody funds." },
        { n: "2", title: "Delegate a Path", body: "Define who may act, which action is allowed, the asset and counterparty scope, the maximum exposure, and the validity period." },
        { n: "3", title: "Accept a Pact", body: "Bind the parties, commercial terms, Proof requirements, payment conditions, and exception policy into one inspectable commitment." },
        { n: "4", title: "Record Proof", body: "Attach delivery, usage, or checkpoint evidence to the commitment. Proof determines whether the configured settlement condition has been met." },
        { n: "5", title: "Authorize payment", body: "The wallet signs exact payment terms. Direct payments need no Workspace. Workspace-scoped payments include the Workspace reference in signed metadata." },
        { n: "6", title: "Verify settlement", body: "Arc Vault state and transaction receipts establish what moved. Indexers make records discoverable but remain replaceable projections." },
      ]),
      h2("State boundaries"),
      kv([
        { k: "Workspace records", v: "Operating context, participants, Paths, Pacts, Proof, and activity" },
        { k: "Wallet authorization", v: "EIP-712 intent or direct transaction approval" },
        { k: "Arc canonical state", v: "Vault state, events, transaction status, and settlement finality" },
        { k: "Indexer projection", v: "Search, discovery, filtering, and historical presentation" },
      ]),
      callout("note", "The Shared Interface Runtime is publicly deployed with Neon persistence. The current Cockpit still records Workspace objects in the browser until its signed Runtime operations and authenticated discovery are wired to that service."),
    ],
  },
  payments: {
    eyebrow: "Welcome",
    title: "Payment models",
    subtitle: "The product surface uses plain payment language. Protocol names remain documented so application developers can map the interface to SDK and contract operations.",
    blocks: [
      h2("Direct payment"),
      p("A connected wallet pays a known recipient without creating a Workspace. Choose one-time settlement for immediate allocation or streaming settlement for value released over a duration."),
      h2("Workspace-scoped payment"),
      p("A payment whose signed metadata references a Workspace. This creates an explicit connection between operating context and settlement, but it does not by itself prove Path authorization, Pact acceptance, or Proof verification. Those lifecycle records remain separate and inspectable."),
      h2("Payment request"),
      p("A shareable request for another party to review and authorize. In the SDK and protocol this maps to the RailsFlow request primitive."),
      h2("Claim link"),
      p("Payer-authorized value that may be claimed later. A bearer link may be claimed by the first eligible holder. A recipient-bound link can only be claimed by the signed address. In the SDK and protocol this maps to the RailsCard primitive."),
      h2("Settlement shapes"),
      list([
        "One-time: the complete allocation becomes immediately settleable under the signed terms.",
        "Streaming: value becomes settleable at the signed rate until the allocation or duration is exhausted.",
        "Gas sponsored: a relayer or Circle smart account submits the authorized call and pays the execution fee.",
        "Self-submit: the connected wallet broadcasts the transaction and pays Arc gas directly.",
      ]),
      callout("warn", "Recipient-bound claims, permits, and sponsored calls are security-sensitive. Verify recipient, expiry, nonce, Vault event, and final Arc receipt before reporting settlement as complete."),
    ],
  },
  concepts: {
    eyebrow: "Welcome",
    title: "Core concepts",
    subtitle: "Understand the payment primitives, replay protection, settlement records, and EIP-712 trust boundaries used by OpenRails.",
    blocks: [
      h2("Protocol primitives and product language"),
      list([
        'Payment Stream (Paycard Stream in the protocol): the onchain Vault entity keyed by paycardId. It escrows USDC and releases value according to signed terms.',
        "Payment Request (RailsFlow in the SDK): a shareable request for another party to review and authorize a payment.",
        "Claim Link (RailsCard in the SDK): payer-authorized value that can be claimed later by a bearer or a signed recipient.",
        "Nonce tracks: nonceChannel and nonceValue provide replay protection while allowing independent payment authorizations.",
        "Receipts: Arc transaction receipts and Vault events establish which operations were included and whether execution succeeded.",
        "Residual settlement: flushResidualDelta returns the remaining Vault balance according to the contract's configured residual recipient.",
      ]),
      h2("Protocol Invariants"),
      list([
        "Non-custodial execution: the Vault pulls the authorized allocation from the payer. Relayers submit signed calls but do not receive custody of the allocation.",
        "On-Chain Vault as Source of Truth: The smart contract state is the ultimate arbiter. All read APIs, indexers, or query layers serve only as convenient, non-authoritative projections.",
        "Signature-based authentication: the Hub validates the EIP-712 payload signature rather than msg.sender, allowing an authorized relayer or smart account to submit the exact signed terms.",
        "Composite Keys for Security: A paycardId is not globally or vault-scoped. To avoid collision and enforce safety, always key stream state by the tuple (vaultAddress, paycardId).",
        "Native Gas Coexistence: On Arc, USDC serves double duty as both the transacted asset and the native gas token. Always maintain a gas margin rather than spending your account down to the absolute last unit.",
      ]),
      h2("The Cryptographic Trust Boundary"),
      p(
        "Payer private keys never touch the network. All transactions originate as local, client-side EIP-712 signatures. While third-party relayers can sponsor gas, they cannot manipulate the intent; any alteration to the payload immediately invalidates the cryptographic signature, preventing unauthorized state changes.",
      ),
      code(
        "text",
        "[ User / Agent ] --- signs EIP-712 intent only ---> [ Relayer / Keeper ]\n      |                                                     |\n      | keys never leave the client                submits tx + pays gas\n      v                                                     v\n[ Arc USDC 0x3600…0000 ] <== vault pulls escrow ==> [ V2 Hub vault ]\n\nArc USDC is REAL Circle-issued USDC, not a mock, and it is also\nthe chain's native gas token (a dual 6-/18-decimal asset).",
      ),
      callout(
        "note",
        "Gasless but Secure: The relayer handles gas fees on behalf of your users but has zero custody or control over the funds. Escrow is pulled directly from the signer validated by the Hub, and any tampering voids the transaction.",
      ),
      callout(
        "note",
        "Naming Conventions: Keep your UI copy aligned with the core primitives (Paycard, RailsFlow, and RailsCard) so developers can map client application code easily to the SDK.",
      ),
    ],
  },
  sdk: {
    eyebrow: "SDK & Toolkit",
    title: "SDK reference",
    subtitle: "Use typed clients, wallet adapters, relay helpers, receipt checks, and Arc network configuration from openrails-sdk.",
    blocks: [
      h2("Installation"),
      code("bash", "npm i openrails-sdk"),
      h2("Quick Import"),
      code(
        "ts",
        'import {\n  LeptonOpenRailsClient, payGasless, claimGasless,\n  RelayClient, signUsdcPermit\n} from "openrails-sdk";\nimport { ethersToSubmitter } from "openrails-sdk/adapters/ethers";\n// or, for a Privy embedded wallet:\nimport { privyToAccount } from "openrails-sdk/adapters/privy";',
      ),
      h2("Pluggable Wallet Architecture"),
      list([
        "OpenRailsAccount: A minimal, sign-only interface. Perfectly suited for embedded wallets (Privy, Turnkey) and ERC-4337 smart accounts where transaction submission is handled off-chain.",
        "OpenRailsSubmitter: Extends the sign-only interface with transaction execution capabilities. Ideal for standard web3 wallets (metamask, rabby) or backend scripts utilizing a direct ethers.Signer.",
        "Sponsored compatibility: sign-only accounts can prepare Hub authorizations for a configured relayer or smart-account submission path.",
      ]),
      h2("Privy Embedded Wallet Integration"),
      code(
        "ts",
        "const provider = await wallet.getEthereumProvider();\nconst account = privyToAccount({ address, provider });\nconst client = LeptonOpenRailsClient.fromAccount(account, hub, chainId);\nawait payGasless({ client, relay, intent });",
      ),
      callout(
        "note",
        "Modular Exports: Refer to the Wallet Abstraction page for Circle smart-account adapters, and Gateway Funding for cross-chain liquidity. Both utilities are shipped as separate modular subpath exports.",
      ),
      callout(
        "note",
        "Sandbox Limits: In production-like environments, funding relies on canonical bridges or the public faucet. The usdc.mint() function is restricted to local-sandbox testing and will fail on the Arc testnet.",
      ),
    ],
  },
  "sdk-wallet": {
    eyebrow: "SDK & Toolkit",
    title: "Wallet abstraction",
    subtitle: "Expose EIP-1271 contract signatures to the protocol. Connect modular smart accounts and multisigs to OpenRails' gasless pipeline using circleToAccount.",
    blocks: [
      h2("Wrapping Smart Accounts & Multisigs"),
      p(
        "Because the on-chain Hub verifies cryptographic validity rather than the transaction caller, smart accounts can execute streams without paying gas directly. The circleToAccount adapter transforms any viem-compatible signer exposing signTypedData into a sign-only OpenRailsAccount.",
      ),
      code(
        "ts",
        'import { circleToAccount } from "openrails-sdk/adapters/circle";\nimport { LeptonOpenRailsClient, payGasless } from "openrails-sdk";\n\n// `smartAccount` is any viem-compatible signer:\n//   { address: string; signTypedData({ domain, types, primaryType, message }) }\nconst account = circleToAccount(smartAccount);\n\nconst client = LeptonOpenRailsClient.fromAccount(account, hub, chainId);\nawait payGasless({ client, relay, intent });',
      ),
      h2("Adapter Mechanics"),
      list([
        "Sets isSmartAccount: true, which directs the on-chain Hub to verify the EIP-712 envelope using EIP-1271 contract signature validation (isValidSignatureNow) instead of standard ECDSA recovery.",
        "Normalizes Payloads: Encodes typed data using ethers.js standards and normalizes chainId formats, ensuring compatibility with viem client expectations.",
        "Sign-Only Signature Output: Exposes getAddress() and signTypedData() to cleanly power payGasless and claimGasless pipelines.",
      ]),
      callout(
        "note",
        "Contract Agnostic: This helper is signer-agnostic and works with any EIP-1271 compliant smart contract. Ensure you verify signature recovery pathways on Arc with your contract's specific implementation before mainnet deployment.",
      ),
    ],
  },
  "sdk-gateway": {
    eyebrow: "SDK & Toolkit",
    title: "Gateway funding",
    subtitle: "Bypass manual bridging friction. Use Circle Gateway to deposit USDC on source chains and programmatically mint it on Arc to back streams on-demand.",
    blocks: [
      h2("Initiating a Gateway Deposit"),
      p(
        "USDC values are denominated in standard 6-decimal base units (mwei). By enabling autoApprove, the SDK automatically detects insufficient allowances and chains the approve transaction before deposit, simplifying user UX to a single signature.",
      ),
      code(
        "ts",
        'import { depositToGateway, mintFromGateway } from "openrails-sdk/gateway";\n\n// deposit 25 USDC (6-decimal base units) into the Gateway Wallet\nconst { txHash } = await depositToGateway({\n  signer,                    // ethers.Signer\n  amountBaseUnits: 25_000_000n,\n  autoApprove: true,         // submit approve() if allowance is insufficient\n});',
      ),
      h2("Third-Party Deposits"),
      code(
        "ts",
        'import { depositForToGateway } from "openrails-sdk/gateway";\n\nawait depositForToGateway({\n  signer,\n  depositor: "0x…",          // the address credited with the balance\n  amountBaseUnits: 25_000_000n,\n});',
      ),
      h2("Materializing Funds on Arc"),
      p("Once Circle processes the deposit, fetch the cryptographic attestation payload and submit it alongside the signature to the Gateway Minter to claim your USDC on the Arc Network."),
      code(
        "ts",
        "const { txHash } = await mintFromGateway({\n  signer,\n  attestationPayload, // hex string from Circle's attestation service\n  signature,          // hex string\n});",
      ),
      h2("Canonical Gateway Addresses"),
      kv([
        { k: "GatewayWallet", v: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
        { k: "GatewayMinter", v: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" },
        { k: "USDC (token)", v: "0x3600000000000000000000000000000000000000" },
      ]),
      callout(
        "note",
        "Precision Note: The GatewayWallet contract expects standard 6-decimal ERC-20 base units. Note that while Arc's native execution layer scales USDC balances to 18 decimals (adding a 10^12 scaling factor) to simplify gas calculation, SDK gateway methods handle this scaling automatically.",
      ),
    ],
  },
  circle: {
    eyebrow: "Integrations",
    title: "Circle integrations",
    subtitle:
      "Circle powers the wallet, authorization, sponsorship, and liquidity paths around OpenRails. OpenRails owns the Workspace, agreement, proof, clearing, and settlement lifecycle.",
    blocks: [
      callout(
        "note",
        "Circle is part of the current application architecture. The statuses below separate code and configuration already present from live external proof that still needs to be completed.",
      ),
      h2("Connected in the application"),
      p("Circle supplies the wallet, authorization, sponsorship, and liquidity primitives around OpenRails. OpenRails remains the authority for Workspace membership, delegated limits, agreements, proof, clearing, settlement, and receipts. A Circle SDK call can move value or submit a transaction; it does not by itself create an OpenRails agreement or prove that work was completed."),
      h3("Arc and USDC"),
      p("Arc is the current lead settlement environment. Circle-issued USDC is the payment asset and Arc's native gas asset. OpenRails binds signed allocations and payment state to the Arc Vault, then verifies the resulting receipt. Arc is the current public proof environment, not a temporary placeholder."),
      h3("Modular Wallets and passkeys"),
      p("The App uses Circle's Modular Wallet SDK to create or unlock a passkey-backed smart account when the Console client key, allowed origin, and client URL are configured. That account signs and submits the OpenRails settlement plan without exposing a private key to the browser. Wallet configuration is not proof of a sponsored Arc transaction."),
      h3("Circle smart-account adapter"),
      p("The SDK exports circleToAccount for Circle or other EIP-1271 smart accounts. It exposes the address and typed-data signing through OpenRails' sign-only account interface. It does not custody keys, grant spending authority, or bypass the Hub's permission checks."),
      h3("Circle Console"),
      p("Console provisions the browser client key and allowed origin used by the Modular Wallet SDK. Public browser configuration is kept separate from private Circle API and entity credentials. The client key alone does not prove Wallet, Gas Station, or Gateway execution."),
      h3("Gas Station"),
      p("The SDK contains the Arc target, sponsorship request boundary, settlement call plan, and verification logic. The App prepares the approve and Vault paycard calls, submits a paymaster-backed UserOperation, waits for the UserOperation and transaction receipts, and checks the exact Paycard event and live Vault state before showing confirmation. The deployed bundle contains the configured public client key, but a controlled 2026-08-12 passkey setup returned HTTP 401 from Circle's Modular Wallet RPC before any UserOperation was sent. The public sponsored proof remains pending Console client-key and allowed-origin correction."),
      h3("Circle Gateway"),
      p("The SDK ships deposit, third-party deposit, and attestation-backed mint helpers for moving USDC into Arc. A same-chain Arc Testnet proof now reconciles the Gateway Minter attestation, Arc mint receipt, delayed Gateway Wallet burn, shared transfer-spec hash, replay guard, fee, and Circle API balance. A funded source-chain-to-Arc proof remains separate and outstanding."),
      h3("Circle x402"),
      p("The x402 artifact, buyer path, and worker path are an HTTP service-payment surface. Historical Arc testnet records prove a paid request through Circle's facilitator, and a separate experiment binds that settlement ID to a real Paycard Stream. The x402 access fee and buyer-funded OpenRails escrow remain separate. This does not automatically become a Workspace, Pact, Proof, or receipt without an explicit application bridge."),
      h2("Next integration work"),
      steps([
        { n: "01", title: "Record sponsored settlement evidence", body: "Run a fresh sponsored Arc settlement and reconcile the UserOperation, transaction receipt, Paycard event, Vault state, and OpenRails receipt." },
        { n: "02", title: "Prove Gateway funding", body: "Complete a source-chain deposit, attestation-backed mint into Arc, and a real OpenRails settlement funded by the resulting balance." },
        { n: "03", title: "Add only useful App Kits", body: "Prioritize Send for one-time value movement and Unified Balance for funding visibility. Add Bridge, Swap, RFQ, or FX only when a real procurement or treasury flow needs them." },
        { n: "04", title: "Connect the Agent Stack", body: "Expose bounded Workspace, Path, Pact, Proof, and Receipt actions through MCP before claiming autonomous agent execution." },
      ]),
      callout(
        "warn",
        "An integration boundary, SDK helper, or capability declaration is not the same as live external execution. The remaining Circle proof is an operational gate, not a change to the OpenRails payment model.",
      ),
    ],
  },
  cli: {
    eyebrow: "SDK & Toolkit",
    title: "CLI reference",
    subtitle: "Automate and debug payment streams from your terminal. The openrails command-line interface provides safety-first execution defaults, dry-runs, and direct diagnostic access to the on-chain Hub.",
    blocks: [
      h2("Spinning up a Payment Stream"),
      code(
        "bash",
        "openrails pay-stream \\\n  --recipient 0x… \\\n  --total-allocation-pool 10000 \\\n  --flow-velocity-per-second 1 \\\n  --lifespan-seconds 3600 \\\n  --execute",
      ),
      h3("Command Configuration Flags"),
      kv([
        { k: "--recipient", v: "address that receives the stream" },
        { k: "--total-allocation-pool", v: "bounded escrow ceiling (base units)" },
        { k: "--flow-velocity-per-second", v: "drip rate (base units / s)" },
        { k: "--lifespan-seconds", v: "stream lifetime" },
        { k: "--execute", v: "submit for real (omit for a dry-run)" },
      ]),
      callout(
        "warn",
        "Irrevocable Operations: Operations like close and flushResidualDelta write permanent state updates on-chain. The CLI enforces explicit confirmation flags; we strongly advise implementing similar friction/confirmation states in user-facing client applications.",
      ),
    ],
  },
  integrate: {
    eyebrow: "Integration Patterns",
    title: "Payment links",
    subtitle:
      "Create serverless, instantly shareable payments. Encode payment requests (RailsFlow) or authorized value links (RailsCard) entirely within URL hash fragments, keeping the payload out of HTTP request logs.",
    blocks: [
      h2("Programmatic Link Generation"),
      p(
        "By encoding the stream configuration inside the URL hash fragment (#), the transaction details are kept entirely client-side. The payload is never sent to any web server, meaning only the user's browser decodes and signs the interaction.",
      ),
      code(
        "ts",
        'const payload = {\n  v: "2.0.0", kind: "flow",       // or "card"\n  chainId: 5042002,\n  hub: "0x941C8029F0f912df3fAb7423890ab2359b996D0b",\n  amount: "25000000",             // 25 USDC, base units\n  rate: "100000",                 // 0.1 USDC/s\n};\nconst link = "https://openrails.link/pay#or=" +\n  btoa(JSON.stringify(payload));',
      ),
      h2("Peer-to-Peer Distribution"),
      p(
        "Distribute these URLs across any communication channel. RailsFlow triggers a request-to-pay flow. RailsCard carries a signed payment intent backed by Hub allowance and is checked against the sender's live balance when claimed.",
      ),
      callout("note", "Decentralized State: The link itself acts as the self-contained state database. No backend server or centralized database is needed to store or resolve the request before it lands on-chain."),
    ],
  },
  x402: {
    eyebrow: "Integration Patterns",
    title: "x402 gated APIs",
    subtitle: "An experimental HTTP 402 pattern for machine-readable payment challenges backed by OpenRails authorization and settlement primitives.",
    blocks: [
      p(
        "The current x402 work is an experiment, not a stable middleware product. It combines HTTP 402 challenges, signed payment terms, relay submission, and receipt checks to test machine-to-machine service payment flows.",
      ),
      h2("x402 Protocol Handshake"),
      steps([
        { n: "1", title: "HTTP 402 Challenge", body: "The server rejects the unauthenticated request with a 402 status, returning a Payment-Required header containing a serialized, bounded stream intent." },
        { n: "2", title: "Client Resolution", body: "The client evaluates the constraints and signs the EIP-712 envelope locally. A configured sponsor may pay the submission fee." },
        { n: "3", title: "Vault Settlement", body: "The client resubmits the request with the Payment-Signature header. The server submits this signed payload to the Hub via the gasless relay to instantiate the vault escrow." },
        { n: "4", title: "Resource Delivery & Streaming", body: "The server returns a 200 OK containing a Payment-Response receipt, unlocks the API stream, and serves content as value drips to the recipient." },
      ]),
      h2("Required HTTP Headers"),
      kv([
        { k: "Payment-Required", v: "server to client: the challenge intent (bounded)" },
        { k: "Payment-Signature", v: "client to server: the signed envelope token" },
        { k: "Payment-Response", v: "server to client: receipt / paycardId" },
      ]),
      h2("Cloudflare Worker Reference Middleware"),
      code(
        "ts",
        'export default {\n  async fetch(req: Request) {\n    const sig = req.headers.get("Payment-Signature");\n    if (!sig) {\n      // Challenge: hand back a bounded intent the caller must sign\n      return new Response("Payment required", {\n        status: 402,\n        headers: { "Payment-Required": btoa(JSON.stringify(intent)) },\n      });\n    }\n    // Settle: relay the signed envelope, then serve the resource\n    await fetch(RELAY + "/relay-open", {\n      method: "POST",\n      headers: { "content-type": "application/json" },\n      body: JSON.stringify({ envelopeToken: sig }),\n    });\n    return new Response(resource, { headers: { "Payment-Response": paycardId } });\n  },\n};',
      ),
      callout(
        "note",
        "Architectural Pattern: The x402 flow is a design pattern composed of existing OpenRails primitives (link payload structures and gasless relays) rather than a rigid middleware library. Review the MCP server reference to see how agents consume these endpoints.",
      ),
    ],
  },
  mcp: {
    eyebrow: "Integration Patterns",
    title: "MCP server (agents)",
    subtitle: "Expose OpenRails discovery, preparation, validation, verification, and read operations to MCP clients without giving the server signing or broadcast authority.",
    blocks: [
      h2("Installing the MCP Server"),
      code("bash", "npm i -g openrails-mcp"),
      p(
        "Configure an MCP client to load openrails-mcp. The server can discover capabilities, prepare operation envelopes, validate requests, verify records, and read supported state. Wallet authorization and transaction submission remain explicit external steps."
      ),
      h2("Agent safety boundary"),
      list([
        "No embedded signer: the MCP server does not create wallets, hold keys, sign payloads, or broadcast transactions.",
        "Prepared limits: operation envelopes carry explicit asset, recipient, amount, authority, and validity constraints for external review and signing.",
        "Replay protection: independent nonce tracks let applications coordinate parallel authorizations without sharing one sequential nonce.",
      ]),
      callout("note", "An autonomous payment demo still requires an external wallet or smart-account runtime, policy logic, a sponsored or self-submit path, and exact receipt verification. MCP alone does not provide those functions."),
    ],
  },
  sidecar: {
    eyebrow: "Integration Patterns",
    title: "MusicBrainz sidecar",
    subtitle: "A real-world showcase of micro-payment streaming. Connect MusicBrainz artist metadata to on-chain payout rails, turning stream scrobbles into per-second royalty settlement.",
    blocks: [
      h2("Architecture & Flow"),
      steps([
        { n: "1", title: "Artist Registry", body: "Associate a MusicBrainz ID (MBID) with an artist's receiving wallet in the sidecar's Cloudflare storage." },
        { n: "2", title: "Session Initialization", body: "Open a listener session backed by a signed EIP-712 envelope, establishing a non-custodial streaming vault for the artist." },
        { n: "3", title: "Micro-Royalty Scrobbling", body: "As tracks play, scrobble events log listening increments to Cloudflare D1, tracking exact per-second pending balances." },
        { n: "4", title: "On-Chain Drip Settlement", body: "A background keeper triggers batch drip settlements to release the accumulated earnings on-chain." },
      ]),
      h2("API Endpoints"),
      kv([
        { k: "PUT /artist/:mbid", v: "register artist wallet (auth: webhook secret): { wallet }" },
        { k: "POST /session/open", v: "{ listenerAddress, artistMbid, budgetUsdc?, velocityPerSecond?, lifespanSeconds?, envelopeToken? }" },
        { k: "POST /webhook/scrobble", v: "log a play: { track: { mbid }, paycardId }" },
      ]),
      p("If omitted, standard session profiles default to budgetUsdc 5000000 (5 USDC), velocityPerSecond 1000, and a lifespanSeconds of 3600."),
      code(
        "bash",
        'curl -X POST .../session/open \\\n  -H "Authorization: Bearer $SECRET" \\\n  -H "content-type: application/json" \\\n  -d \'{"listenerAddress":"0x…","artistMbid":"…","budgetUsdc":"5000000","envelopeToken":"…"}\'',
      ),
      callout(
        "warn",
        "Security Invariant: Always supply a listener-signed envelopeToken in production. The server-funded fallback is strictly for local sandbox demonstration and breaks the non-custodial protocol design.",
      ),
    ],
  },
  keepers: {
    eyebrow: "Integration Patterns",
    title: "Reconciliation keepers",
    subtitle: "Keep the streams flowing permissionlessly. Implement background cron workers that monitor open Paycard Streams and execute checkpoints on-chain.",
    blocks: [
      h2("Keeper Protocol Mechanics"),
      list([
        "State Monitoring: Monitors active Paycard Streams by parsing PaycardProvisioned event logs within a sliding block window.",
        "Automated Settling: For any active stream with accrued value, calculates the streaming delta and calls processDripSettle once it exceeds a minimum gas-efficient dust threshold.",
        "Lifespan Resolution: Immediately unlocks one-time cards (lifespan 0) on the first settlement; standard streams drip gradually based on flowVelocityPerSecond.",
        "Restricted execution scope: keepers only call configured settlement methods. They do not receive payer signing authority or custody of the Vault allocation.",
      ]),
      h2("Manual Keeper Execution"),
      p("While the production keeper runs on a recurring cron, developers can trigger an immediate manual reconciliation sweep using an authenticated endpoint."),
      code(
        "text",
        "POST https://openrails-reconciliation-worker.microcosm.workers.dev/reconcile\nAuthorization: Bearer $ADMIN_TOKEN",
      ),
      h2("Keeper Discovery Modes"),
      kv([
        { k: "chain (default)", v: "settle every active rail discovered on-chain" },
        { k: "d1 (legacy)", v: "settle only paycards referenced by unsettled rows in the music plays table" },
      ]),
      callout(
        "note",
        "Zero Custody: The reconciliation keeper performs public service execution. Funds flow directly from payer to recipient according to on-chain logic; the keeper only submits transactions and covers gas.",
      ),
    ],
  },
  "cross-chain": {
    eyebrow: "Integration Patterns",
    title: "Cross-chain funding",
    subtitle: "Review the available and planned paths for moving USDC into Arc before opening an OpenRails payment.",
    blocks: [
      p(
        "OpenRails operates natively on the Arc Network. To back your streams with capital originating on Ethereum, Arbitrum, or other chains, you must first bridge USDC. Two primary Circle-based cross-chain paths exist. Choose based on your latency and canonical requirements.",
      ),
      h2("Circle Gateway (Instant On-Demand Liquidity)"),
      p(
        "Circle Gateway provides a unified cross-chain balance. OpenRails exposes SDK helpers for Gateway deposit and mint workflows, but applications must still verify supported chains, balances, attestations, and destination finality.",
      ),
      kv([
        { k: "GatewayWallet", v: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
        { k: "GatewayMinter", v: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" },
        { k: "SDK", v: "depositToGateway / mintFromGateway (see Gateway funding)" },
        { k: "status", v: "helpers shipped; fresh SDK deposit-to-mint proof outstanding" },
      ]),
      h2("Circle CCTP (Canonical Cross-Chain Transfer Protocol)"),
      p(
        "Circle CCTP moves USDC through a source-chain burn and destination-chain mint. Applications must account for the supported source chain, attestation, destination domain, and finality requirements.",
      ),
      kv([
        { k: "CCTP domain", v: "26" },
        { k: "TokenMessengerV2", v: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" },
        { k: "MessageTransmitterV2", v: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" },
        { k: "TokenMinterV2", v: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192" },
        { k: "transfer mode", v: "Standard Transfer only, as Fast Transfer is N/A on Arc" },
        { k: "status", v: "prepare-only SDK boundary; live burn, attestation, and Arc mint proof outstanding" },
      ]),
      callout(
        "note",
        "Current integration status: Gateway deposit and mint helpers are implemented in the SDK, while a fresh live cross-chain proof remains required before the product should present Gateway funding as end-to-end verified. The SDK also prepares CCTP V2 source approval and burn calls, reads Circle attestation status, prepares the Arc receiveMessage call after attestation, and carries a Workspace funding reference for direct or streaming settlement. It does not sign, broadcast, mint, or claim a CCTP payment receipt.",
      ),
    ],
  },
  onchain: {
    eyebrow: "Protocol Reference",
    title: "Contracts & onchain facts",
    subtitle: "The protocol's raw technical specifications. Access contract addresses, EIP-712 configurations, chain IDs, and the complete Hub smart contract ABI.",
    blocks: [
      h2("Arc Network Configuration"),
      kv([
        { k: "chainId", v: "5042002" },
        { k: "RPC", v: "https://rpc.testnet.arc.io" },
        { k: "explorer", v: "https://testnet.arcscan.app" },
        { k: "EIP-712 domain version", v: '"2.0.0"' },
      ]),
      h2("Deployed Contract Addresses"),
      p("All contract deployments are verified on-chain. You can audit their code and transaction logs on the Arc Block Explorer."),
      kv([
        { k: "V2 hub (canonical)", v: "0x941C8029F0f912df3fAb7423890ab2359b996D0b" },
        { k: "V2 factory", v: "0xf85c20858Bac4f9C67a53e4e7a8F31025D07Bc93" },
        { k: "USDC (= gas token)", v: "0x3600000000000000000000000000000000000000" },
        { k: "V1 hub (frozen)", v: "0x01EC54846524D043fD808152D41596beF603381d" },
      ]),
      h2("V2 Hub Smart Contract ABI"),
      p("Interact directly with the V2 Hub. Below is the human-readable ethers.js v6 ABI defining core state reads, stream creation, and settlement execution."),
      code(
        "ts",
        "export const OPENRAILS_HUB_ABI = [\n  'function registry(bytes32 paycardId) view returns (address payer, address recipient, bytes32 metadataHash, uint256 totalAllocationPool, uint256 availableBalance, uint256 flowVelocityPerSecond, uint256 genesisTimestamp, uint256 lifespanSeconds, uint256 lastCheckpointEpoch, address residualDeltaRecipient, uint8 operationalStatus)',\n  'function openPaycardChannel(bytes32 paycardId, bytes32 metadataHash, address recipient, uint256 totalAllocationPool, uint256 flowVelocityPerSecond, uint256 genesisTimestamp, uint256 lifespanSeconds, address residualDeltaRecipient, bytes envelopeSignature, uint256 nonceChannel, uint256 nonceValue, address payer) external',\n  'function claimWildcardPaycardChannel(bytes32 paycardId, bytes32 metadataHash, address claimRecipient, uint256 totalAllocationPool, uint256 flowVelocityPerSecond, uint256 genesisTimestamp, uint256 lifespanSeconds, address residualDeltaRecipient, bytes envelopeSignature, uint256 nonceChannel, uint256 nonceValue, address payer) external',\n  'function processDripSettle(bytes32 paycardId) external',\n  'function flushResidualDelta(bytes32 paycardId) external'\n];",
      ),
      callout(
        "warn",
        'Legacy Version Warning: The V1 Hub (domain 1.0.0) is officially deprecated, frozen for new channel creations, and currently draining existing escrow balances. Never mix V1 and V2 signatures or interact with deprecated deployments in new integrations.',
      ),
    ],
  },
  api: {
    eyebrow: "Protocol Reference",
    title: "REST / indexer API",
    subtitle:
      "Query historical streams and vault events. Leverage our high-performance, factory-aware indexer API to search across all deployed OpenRails vaults.",
    blocks: [
      h2("Shared Interface Runtime"),
      code("text", "https://openrails-interface-worker.microcosm.workers.dev"),
      p("The public Interface 1.2 Worker provides safe REST preparation, validation, verification, reads, and a signed control-plane Runtime backed by Neon Postgres. It does not sign, broadcast, hold keys, or move value."),
      h2("API Base Endpoint"),
      code("text", H),
      h2("REST API Endpoints"),
      kv([
        { k: "GET /vaults", v: "every watched vault" },
        { k: "GET /streams", v: "?vaultAddress=&payer=&recipient=&metadataHash=&status=" },
        { k: "GET /streams/:vault/:paycardId/history", v: "full event history (composite key where both segments required)" },
        { k: "GET /workflows/:id", v: 'returns 501 today, so do not treat empty as "no data"' },
        { k: "GET /transactions/:hash", v: "events + affected streams for a tx" },
      ]),
      callout(
        "note",
        "Consistency Model: The on-chain Vault smart contract remains the single source of truth. The indexer API serves as an eventually-consistent cache; never treat indexer reads as finalized facts in high-stakes financial operations.",
      ),
    ],
  },
  relay: {
    eyebrow: "Protocol Reference",
    title: "Faucet & gasless relay",
    subtitle: "Use the rate-limited testnet faucet and configured relay paths for sponsored OpenRails calls, with explicit self-submit recovery when sponsorship is unavailable.",
    blocks: [
      h2("Developer Faucet Service"),
      code(
        "bash",
        'curl -X POST https://openrails-faucet-worker.microcosm.workers.dev/fund \\\n  -H "content-type: application/json" \\\n  -d \'{"address":"0x…"}\'',
      ),
      p("Our CORS-enabled public developer faucet allows frontends to request testnet assets directly. It supplies testnet USDC which functions natively as gas on Arc."),
      list([
        "Returns { txHash, amount } upon successful funding.",
        "Returns { skipped: true } if the address has already been provisioned with sufficient assets.",
        "Returns HTTP 429 or 503 with structured error details when hitting cooldown limits or global daily thresholds; surface these directly in your UI for developer clarity.",
      ]),
      h2("Gasless Relayer Endpoints"),
      p("The gasless relayer submits transactions on behalf of users, sponsoring the necessary fees. The SDK handles this flow transparently via payGasless() and claimGasless() wrapper methods."),
      code(
        "text",
        "POST https://openrails-reconciliation-worker.microcosm.workers.dev/relay-open\nPOST https://openrails-reconciliation-worker.microcosm.workers.dev/relay-claim",
      ),
      callout(
        "note",
        "Authorization boundary: the Hub recovers payer identity from the EIP-712 signature rather than msg.sender. A relayer can only submit the exact signed terms, and successful submission must still be confirmed against the Arc receipt and Vault state.",
      ),
    ],
  },
};

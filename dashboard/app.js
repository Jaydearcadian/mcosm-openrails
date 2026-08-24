import QRCode from "qrcode";
import { ethers } from "ethers";
import {
  createRailsCardClaimLink,
  createRailsFlowRequestLink,
  parseOpenRailsLink,
} from "../sdk/src/links";
import { serializeEnvelope, deserializeEnvelope } from "../sdk/src/serialization";
import { hashOpenRailsMetadata } from "../sdk/src/metadata";
import {
  buildOpenRailsAccessHeaders,
  createOpenRailsAccessCredential,
  createOpenRailsFetch,
  serializeOpenRailsAccessCredential,
} from "../sdk/src/access";
import {
  OPENRAILS_HUB_ABI,
  approveOpenRailsSpend,
  assertOpenRailsNetwork,
  readNonce,
  readTokenAllowance,
  readTokenBalance,
  signPermissionEnvelopeWithSigner,
  submitFlushWithSigner,
  submitOpenPaycardWithSigner,
  submitSettleWithSigner,
  switchOrAddOpenRailsNetwork,
} from "../sdk/src/wallet";
import {
  createPaymentReceipt,
  createResidualRecoveryReceipt,
  createSettlementReceipt,
  parseReceipt,
  serializeReceipt,
} from "../sdk/src/receipts";

// OpenRails V1 Dashboard Controller

const BACKEND_URL = "http://localhost:3001";
let config = null;
let activePaycard = null;
let isPolling = false;
let dripInterval = null;
let autoDripInterval = null;
let autoDripInFlight = false;
let browserProvider = null;
let browserSigner = null;
let walletAddress = "";
let walletListenersRegistered = false;
let latestReceipt = null;
const sessionMetrics = {
  streamsOpened: 0,
  escrowed: 0n,
  settled: 0n,
  recovered: 0n,
  receipts: 0,
  wallets: new Set(),
  txHashes: []
};

const RAIL_COPY = {
  railsflow: {
    title: "RailsFlow payment request",
    guide: "RailsFlow starts as a merchant request. It cannot move funds until the payer reviews the Request Stream terms, signs, and explicitly opens a Paycard Stream.",
    shareType: "Unsigned RailsFlow Request Link",
    shareWarning: "Unsigned RailsFlow request. This is safe to review: no funds move until the payer signs and opens a Paycard Stream.",
    nextStep: "Next: payer reviews terms, signs with wallet, then opens the Paycard Stream from Pay Stream."
  },
  railscard_bearer: {
    title: "Bearer RailsCard value link",
    guide: "Bearer RailsCard is a payer-signed bearer value link. Treat it like cash until claimed: first valid holder with the URL, QR, or executable token can redeem.",
    shareType: "Bearer RailsCard Value Link",
    shareWarning: "Bearer RailsCard value link. Treat like cash until claimed: anyone with this unclaimed link, QR, or token can redeem first.",
    nextStep: "Next: enter the wallet that should claim this bearer RailsCard, then broadcast or submit from wallet."
  },
  railscard_recipient_bound: {
    title: "Recipient-bound RailsCard value link",
    guide: "Recipient-bound RailsCard is a payer-signed value link locked to one wallet. It cannot be redirected to another recipient after signing.",
    shareType: "Recipient-bound RailsCard Value Link",
    shareWarning: "Recipient-bound RailsCard. Only the signed recipient wallet can redeem this value link.",
    nextStep: "Next: signed recipient reviews terms and opens the Paycard Stream."
  }
};

// DOM Elements
const elNetworkStatus = document.getElementById("network-status");
const elWalletStrip = document.getElementById("wallet-strip");
const elBtnConnectWallet = document.getElementById("btn-connect-wallet");
const elBtnSwitchWalletNetwork = document.getElementById("btn-switch-wallet-network");
const elWalletStatus = document.getElementById("wallet-status");
const elWalletBalance = document.getElementById("wallet-balance");
const elWalletAllowance = document.getElementById("wallet-allowance");
const elWalletNetworkHint = document.getElementById("wallet-network-hint");
const elPaycardIdInput = document.getElementById("intent-paycard-id");
const elBtnGenerateId = document.getElementById("btn-generate-id");
const elAllocationInput = document.getElementById("intent-allocation");
const elVelocityInput = document.getElementById("intent-velocity");
const elRecipientInput = document.getElementById("intent-recipient");
const elRecoveryInput = document.getElementById("intent-recovery");
const elLifespanInput = document.getElementById("intent-lifespan");
const elPayerKeyInput = document.getElementById("intent-payer-key");
const elModeInput = document.getElementById("intent-mode");
const elRailModeGuide = document.getElementById("rail-mode-guide");
const elNonceChannelInput = document.getElementById("intent-nonce-channel");
const elNonceValueInput = document.getElementById("intent-nonce-value");
const elClaimRecipientInput = document.getElementById("claim-recipient");
const elMetadataRefInput = document.getElementById("intent-metadata-ref");
const elWorkflowIdInput = document.getElementById("intent-workflow-id");
const elMetadataHashInput = document.getElementById("intent-metadata-hash");
const elArcActionStack = document.getElementById("arc-action-stack");
const elBtnApproveArcSpend = document.getElementById("btn-approve-arc-spend");
const elBtnSignArcEnvelope = document.getElementById("btn-sign-arc-envelope");
const elBtnOpenArcPaycard = document.getElementById("btn-open-arc-paycard");
const elBtnGenerateEnvelope = document.getElementById("btn-generate-envelope");
const elBtnCreateRequestLink = document.getElementById("btn-create-request-link");

const elEnvelopeOutputContainer = document.getElementById("envelope-output-container");
const elEnvelopePayloadText = document.getElementById("envelope-payload-text");
const elBtnCopyEnvelope = document.getElementById("btn-copy-envelope");
const elShareArtifactContainer = document.getElementById("share-artifact-container");
const elShareArtifactType = document.getElementById("share-artifact-type");
const elShareArtifactWarning = document.getElementById("share-artifact-warning");
const elShareLinkOutput = document.getElementById("share-link-output");
const elBtnCopyShareLink = document.getElementById("btn-copy-share-link");
const elShareQrCanvas = document.getElementById("share-qr-canvas");
const elInterceptorPreview = document.getElementById("interceptor-preview");
const elInboundLinkContainer = document.getElementById("inbound-link-container");
const elInboundLinkStatus = document.getElementById("inbound-link-status");
const elInboundLinkDetails = document.getElementById("inbound-link-details");

const elRelayerTitle = document.getElementById("relayer-title");
const elRelayerSubtitle = document.getElementById("relayer-subtitle");
const elRelayerFlowCopy = document.getElementById("relayer-flow-copy");
const elRelayerCapPanel = document.getElementById("relayer-cap-panel");
const elRelayerCapCopy = document.getElementById("relayer-cap-copy");
const elRelayerInputToken = document.getElementById("relayer-input-token");
const elBtnSubmitRelayer = document.getElementById("btn-submit-relayer");
const elRelayerStatusContainer = document.getElementById("relayer-status-container");
const elRelayerStatusLabel = document.getElementById("relayer-status-label");
const elReceiptTxLink = document.getElementById("receipt-tx-link");
const elReceiptStatus = document.getElementById("receipt-status");
const elReceiptSubmissionMode = document.getElementById("receipt-submission-mode");

const elPaycardEmptyState = document.getElementById("paycard-empty-state");
const elPaycardActiveState = document.getElementById("paycard-active-state");
const elDisplayCardId = document.getElementById("display-card-id");
const elDisplayStatus = document.getElementById("display-status");
const elDisplayFluidFill = document.getElementById("display-fluid-fill");
const elDisplayAvailableBalance = document.getElementById("display-available-balance");
const elDisplayVelocity = document.getElementById("display-velocity");
const elDisplayPayer = document.getElementById("display-payer");
const elDisplayRecipient = document.getElementById("display-recipient");
const elDisplayRecovery = document.getElementById("display-recovery");
const elDisplayLifespan = document.getElementById("display-lifespan");

const elBtnBlockchainTick = document.getElementById("btn-blockchain-tick");
const elBtnProcessDrip = document.getElementById("btn-process-drip");
const elBtnAutoDrip = document.getElementById("btn-auto-drip");
const elBtnFlushDelta = document.getElementById("btn-flush-delta");
const elLedgerActionStatus = document.getElementById("ledger-action-status");
const elAgentTraceSummary = document.getElementById("agent-trace-summary");
const elAgentTraceList = document.getElementById("agent-trace-list");
const elMetricStreams = document.getElementById("metric-streams");
const elMetricEscrowed = document.getElementById("metric-escrowed");
const elMetricSettled = document.getElementById("metric-settled");
const elMetricRecovered = document.getElementById("metric-recovered");
const elMetricReceipts = document.getElementById("metric-receipts");
const elMetricWallets = document.getElementById("metric-wallets");
const elMetricRecentTx = document.getElementById("metric-recent-tx");
const elTesterFlowStatus = document.getElementById("tester-flow-status");
const elReceiptSummary = document.getElementById("receipt-summary");
const elReceiptJsonOutput = document.getElementById("receipt-json-output");
const elBtnCopyReceipt = document.getElementById("btn-copy-receipt");
const elRecoveryArtifactInput = document.getElementById("recovery-artifact-input");
const elBtnRecoverArtifact = document.getElementById("btn-recover-artifact");
const elRecoveryWalletInput = document.getElementById("recovery-wallet-input");
const elRecoveryMetadataInput = document.getElementById("recovery-metadata-input");
const elRecoveryFromBlockInput = document.getElementById("recovery-from-block");
const elRecoveryToBlockInput = document.getElementById("recovery-to-block");
const elBtnRecoverWallet = document.getElementById("btn-recover-wallet");
const elRecoveryStatus = document.getElementById("recovery-status");
const elRecoveryResults = document.getElementById("recovery-results");
const elHistoryPaycardInput = document.getElementById("history-paycard-input");
const elBtnLoadHistory = document.getElementById("btn-load-history");
const elHistoryStatus = document.getElementById("history-status");
const elHistoryResults = document.getElementById("history-results");
const elBtnCheckX402Bridge = document.getElementById("btn-check-x402-bridge");
const elX402BridgeSummary = document.getElementById("x402-bridge-summary");
const elX402BridgeOutput = document.getElementById("x402-bridge-output");
const elToggleJudgeScript = document.getElementById("toggle-judge-script");
const elJudgeScriptPanel = document.getElementById("judge-script-panel");

const elBalanceAgent = document.getElementById("balance-agent");
const elBalanceMerchant = document.getElementById("balance-merchant");
const elBalanceRecovery = document.getElementById("balance-recovery");
const elBalanceContract = document.getElementById("balance-contract");
const elBtnMintFaucet = document.getElementById("btn-mint-faucet");

const elAccessPanel = document.getElementById("access-panel");
const elAccessServiceOrigin = document.getElementById("access-service-origin");
const elAccessServiceAddress = document.getElementById("access-service-address");
const elAccessScope = document.getElementById("access-scope");
const elAccessTtl = document.getElementById("access-ttl");
const elBtnIssueAccess = document.getElementById("btn-issue-access");
const elBtnCopyAccessHeaders = document.getElementById("btn-copy-access-headers");
const elBtnTestAccess = document.getElementById("btn-test-access");
const elAccessTokenOutput = document.getElementById("access-token-output");
const elAccessHeadersOutput = document.getElementById("access-headers-output");
const elAccessStatus = document.getElementById("access-status");

let latestAccessCredentialToken = "";
let latestArcEnvelopeToken = "";

// Init
window.addEventListener("DOMContentLoaded", async () => {
  generateNewPaycardId();
  await fetchConfig();
  await refreshBalances();
  updateSessionMetrics();
  updateAgentDecisionTrace("Ready");
  updateRailModeGuide();
  
  // Setup Event Listeners
  elBtnGenerateId.addEventListener("click", handlePaycardIdAction);
  elBtnConnectWallet.addEventListener("click", connectWallet);
  elBtnSwitchWalletNetwork.addEventListener("click", switchToConfiguredNetwork);
  elBtnCreateRequestLink.addEventListener("click", createRailsFlowRequestArtifact);
  elBtnApproveArcSpend.addEventListener("click", approveArcSpend);
  elBtnSignArcEnvelope.addEventListener("click", signArcEnvelope);
  elBtnOpenArcPaycard.addEventListener("click", openSignedArcEnvelope);
  elBtnGenerateEnvelope.addEventListener("click", generateAndSignEnvelope);
  elBtnCopyEnvelope.addEventListener("click", copyEnvelopeToClipboard);
  elBtnCopyShareLink.addEventListener("click", copyShareLinkToClipboard);
  elBtnCopyReceipt.addEventListener("click", copyReceiptToClipboard);
  elBtnRecoverArtifact.addEventListener("click", recoverPaycardFromArtifact);
  elBtnRecoverWallet.addEventListener("click", recoverPaycardsFromWallet);
  elBtnLoadHistory.addEventListener("click", loadStreamHistory);
  elBtnCheckX402Bridge.addEventListener("click", checkX402BridgeGate);
  elToggleJudgeScript.addEventListener("change", toggleJudgeScript);
  elModeInput.addEventListener("change", () => {
    updateClaimRecipientLock();
    updateRailModeGuide();
  });
  elRelayerInputToken.addEventListener("input", () => {
    latestArcEnvelopeToken = "";
    elBtnOpenArcPaycard.disabled = true;
    toggleRelayerButton();
  });
  elBtnSubmitRelayer.addEventListener("click", broadcastRelayerTx);
  [
    elPaycardIdInput,
    elAllocationInput,
    elVelocityInput,
    elRecipientInput,
    elRecoveryInput,
    elLifespanInput,
    elModeInput,
    elNonceChannelInput,
    elNonceValueInput,
    elMetadataRefInput,
    elWorkflowIdInput
  ].forEach((input) => {
    input.addEventListener("input", resetSignedArcEnvelope);
    input.addEventListener("change", resetSignedArcEnvelope);
  });
  elBtnBlockchainTick.addEventListener("click", tickTime);
  elBtnProcessDrip.addEventListener("click", processDripSettle);
  elBtnAutoDrip.addEventListener("click", toggleAutoDrip);
  elBtnFlushDelta.addEventListener("click", flushResidualDelta);
  elBtnMintFaucet.addEventListener("click", mintFaucetUSDC);
  elBtnIssueAccess.addEventListener("click", issueAccessCredential);
  elBtnCopyAccessHeaders.addEventListener("click", copyAccessHeaders);
  elBtnTestAccess.addEventListener("click", testProtectedAccess);
  window.addEventListener("hashchange", handleInboundOpenRailsLink);
  await handleInboundOpenRailsLink();
});

// Generate a random Bytes32 Hex for Paycard ID
function generateNewPaycardId() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  const hex = "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  elPaycardIdInput.value = hex;
  resetSignedArcEnvelope();
}

function handlePaycardIdAction() {
  if (config?.capabilities?.canUsePrivateKeySigning === false) {
    const paycardId = elPaycardIdInput.value.trim();
    if (!ethers.isHexString(paycardId, 32)) {
      generateNewPaycardId();
      setLedgerActionStatus("Generated a new Arc testnet Paycard ID for wallet submission.");
      return;
    }
    startPollingPaycard(paycardId);
    return;
  }
  generateNewPaycardId();
}

function shortAddress(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function setWalletReadinessState(state) {
  elWalletStrip.classList.remove("state-idle", "state-ready", "state-warning", "state-error");
  elWalletStrip.classList.add(`state-${state}`);
  elWalletStrip.dataset.state = state;
}

function setTransactionPanelState(state) {
  elRelayerStatusContainer.classList.remove("state-pending", "state-success", "state-error");
  if (state) elRelayerStatusContainer.classList.add(`state-${state}`);
}

function setActionMessageState(element, state) {
  element.classList.remove("state-pending", "state-success", "state-error", "danger");
  if (state) element.classList.add(`state-${state}`);
}

function inferMessageState(message, isError = false) {
  if (isError) return "error";
  return /requesting|submitting|searching|checking|open your wallet|running|pending/i.test(message)
    ? "pending"
    : "success";
}

function isArcWalletMode() {
  return config?.networkMode === "arc-testnet";
}

function resetSignedArcEnvelope() {
  latestArcEnvelopeToken = "";
  elRelayerInputToken.value = "";
  elEnvelopePayloadText.textContent = "";
  elEnvelopeOutputContainer.classList.add("hidden");
  if (elBtnOpenArcPaycard) elBtnOpenArcPaycard.disabled = true;
  toggleRelayerButton();
}

function isPublicRelayerMode() {
  return isArcWalletMode() && config?.publicRelayer?.enabled === true;
}

function publicRelayerCapSummary() {
  const caps = config?.publicRelayer?.caps;
  if (!caps) return "No public relayer caps advertised.";
  return `Max ${caps.maxAllocationUsdc} USDC, ${caps.maxLifespanSeconds}s lifespan, ${caps.maxVelocityUsdcPerSecond} USDC/sec. Public relayer opens only; settlement and close require payer or recipient wallet.`;
}

function getWalletNetworkParams() {
  if (!config) throw new Error("Gateway configuration is not loaded.");
  if (config.chainId !== 5042002) {
    throw new Error(`No one-click wallet metadata configured for chain ${config.chainId}.`);
  }
  return {
    chainId: config.chainId,
    chainName: "Arc Testnet",
    nativeCurrency: {
      name: "USDC",
      symbol: "USDC",
      decimals: 6,
    },
    rpcUrls: [
      "https://rpc.testnet.arc.io",
      "https://rpc.drpc.testnet.arc.io",
      "https://rpc.blockdaemon.testnet.arc.io",
    ],
    blockExplorerUrls: [config.explorerBaseUrl || "https://testnet.arcscan.app"],
  };
}

async function refreshConnectedWallet() {
  browserProvider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await browserProvider.send("eth_accounts", []);
  if (!accounts.length) {
    browserSigner = null;
    walletAddress = "";
    elBtnConnectWallet.textContent = "Connect Wallet";
    resetSignedArcEnvelope();
    await refreshWalletState();
    return;
  }
  browserSigner = await browserProvider.getSigner();
  walletAddress = await browserSigner.getAddress();
  sessionMetrics.wallets.add(walletAddress.toLowerCase());
  updateSessionMetrics();
  if (isArcWalletMode()) {
    if (!ethers.isAddress(elRecipientInput.value)) elRecipientInput.value = walletAddress;
    if (!ethers.isAddress(elRecoveryInput.value)) elRecoveryInput.value = walletAddress;
    if (!ethers.isAddress(elClaimRecipientInput.value)) elClaimRecipientInput.value = walletAddress;
    resetSignedArcEnvelope();
  }
  if (!ethers.isAddress(elRecoveryWalletInput.value || "")) {
    elRecoveryWalletInput.value = walletAddress;
  }
  elBtnConnectWallet.textContent = "Wallet Connected";
  await refreshWalletState();
}

function registerWalletListeners() {
  if (walletListenersRegistered || !window.ethereum?.on) return;
  window.ethereum.on("chainChanged", () => {
    refreshConnectedWallet().catch((err) => {
      console.error("Wallet chain refresh failed:", err);
    });
  });
  window.ethereum.on("accountsChanged", () => {
    refreshConnectedWallet().catch((err) => {
      console.error("Wallet account refresh failed:", err);
    });
  });
  walletListenersRegistered = true;
}

async function switchToConfiguredNetwork() {
  if (!window.ethereum) {
    setLedgerActionStatus("No injected EVM wallet found. Install an Arc-compatible wallet.", true);
    return;
  }
  if (!isArcWalletMode()) {
    setLedgerActionStatus("Arc wallet switching is available only when the backend is running in Arc testnet mode.", true);
    return;
  }
  try {
    elBtnSwitchWalletNetwork.disabled = true;
    elBtnSwitchWalletNetwork.textContent = "Open Wallet...";
    setLedgerActionStatus("Open your wallet to connect, then approve the Arc testnet switch/add prompt.");
    browserProvider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await browserProvider.send("eth_accounts", []);
    if (!accounts.length) {
      await browserProvider.send("eth_requestAccounts", []);
      registerWalletListeners();
      await refreshConnectedWallet();
    }
    elBtnSwitchWalletNetwork.textContent = "Check Wallet...";
    setLedgerActionStatus("Requesting Arc testnet switch/add in wallet...");
    const result = await switchOrAddOpenRailsNetwork(window.ethereum, getWalletNetworkParams());
    await refreshConnectedWallet();
    setLedgerActionStatus(result === "added" ? "Arc testnet added. Confirm the network switch in your wallet if prompted." : "Wallet switched to Arc testnet.");
  } catch (err) {
    console.error("Wallet network switch failed:", err);
    setLedgerActionStatus(`Wallet network switch failed: ${err.message}`, true);
  } finally {
    elBtnSwitchWalletNetwork.disabled = false;
    elBtnSwitchWalletNetwork.textContent = "Switch/Add Arc Testnet";
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setLedgerActionStatus("No injected EVM wallet found. Install an Arc-compatible wallet.", true);
    return;
  }
  try {
    browserProvider = new ethers.BrowserProvider(window.ethereum);
    setLedgerActionStatus(isArcWalletMode()
      ? "Open your wallet to connect. If needed, an Arc testnet switch/add prompt will appear next."
      : "Open your wallet to connect.");
    await browserProvider.send("eth_requestAccounts", []);
    registerWalletListeners();
    await refreshConnectedWallet();
    if (isArcWalletMode()) {
      const network = await browserProvider.getNetwork();
      if (Number(network.chainId) !== config.chainId) {
        await switchToConfiguredNetwork();
      }
    }
  } catch (err) {
    console.error("Wallet connection failed:", err);
    setLedgerActionStatus(`Wallet connection failed: ${err.message}`, true);
  }
}

async function ensureWalletReady() {
  if (!browserSigner || !browserProvider) {
    throw new Error("Connect an Arc-compatible wallet first.");
  }
  try {
    await assertOpenRailsNetwork(browserProvider, config.chainId);
  } catch (err) {
    if (!isArcWalletMode()) throw err;
    await switchToConfiguredNetwork();
    await assertOpenRailsNetwork(browserProvider, config.chainId);
  }
  return browserSigner;
}

async function refreshWalletState() {
  if (!browserSigner || !browserProvider || !config) {
    setWalletReadinessState(isArcWalletMode() ? "warning" : "idle");
    elWalletStatus.textContent = "Disconnected";
    elWalletBalance.textContent = "—";
    elWalletAllowance.textContent = "—";
    elBtnSwitchWalletNetwork.classList.toggle("hidden", !isArcWalletMode());
    elBtnSwitchWalletNetwork.disabled = !isArcWalletMode();
    if (isArcWalletMode()) {
      elWalletNetworkHint.textContent = "Click Connect Wallet or Switch/Add Arc Testnet. Your wallet will ask to connect, then switch or add Arc.";
      elWalletNetworkHint.classList.remove("hidden");
    } else {
      elWalletNetworkHint.classList.add("hidden");
      elWalletNetworkHint.textContent = "";
    }
    return;
  }
  try {
    const network = await browserProvider.getNetwork();
    const wrongNetwork = Number(network.chainId) !== config.chainId;
    elBtnSwitchWalletNetwork.classList.toggle("hidden", !isArcWalletMode());
    elBtnSwitchWalletNetwork.disabled = !wrongNetwork;
    elWalletStatus.textContent = wrongNetwork
      ? `${shortAddress(walletAddress)} · wrong chain ${Number(network.chainId)}`
      : `${shortAddress(walletAddress)} · ready`;
    if (wrongNetwork) {
      setWalletReadinessState("warning");
      elWalletBalance.textContent = "Wrong chain";
      elWalletAllowance.textContent = "Wrong chain";
      elWalletNetworkHint.textContent = `Wallet is on chain ${Number(network.chainId)}. Switch to Arc testnet ${config.chainId} to continue.`;
      elWalletNetworkHint.classList.remove("hidden");
      return;
    }
    setWalletReadinessState("ready");
    elWalletNetworkHint.classList.add("hidden");
    elWalletNetworkHint.textContent = "";
    const [balance, allowance] = await Promise.all([
      readTokenBalance(browserProvider, config.usdcAddress, walletAddress),
      readTokenAllowance(browserProvider, config.usdcAddress, walletAddress, config.clearinghouseAddress),
    ]);
    elWalletBalance.textContent = formatUSDC(balance.toString());
    elWalletAllowance.textContent = formatUSDC(allowance.toString());
  } catch (err) {
    console.error("Wallet state refresh failed:", err);
    setWalletReadinessState("error");
    elWalletStatus.textContent = `${shortAddress(walletAddress)} · check failed`;
  }
}

function showWalletReceipt(tx, label) {
  elRelayerStatusContainer.classList.remove("hidden");
  setTransactionPanelState("pending");
  elRelayerStatusLabel.textContent = label;
  elReceiptTxLink.textContent = tx.hash;
  elReceiptTxLink.href = config.explorerBaseUrl ? `${config.explorerBaseUrl}/tx/${tx.hash}` : "#";
  elReceiptStatus.textContent = "Pending confirmation";
  elReceiptSubmissionMode.textContent = isArcWalletMode()
    ? "Wallet-signed Arc transaction"
    : "Wallet-signed local transaction";
}

function markWalletReceiptFailed() {
  if (!elRelayerStatusContainer.classList.contains("hidden")) {
    setTransactionPanelState("error");
    elReceiptStatus.textContent = "Failed or rejected";
  }
}

// Fetch setup configuration from Server
async function fetchConfig() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/config`);
    if (!res.ok) throw new Error("Server config request failed");
    config = await res.json();
    
    // Fill in presets
    if (config.localSandbox) {
      elRecipientInput.value = config.presets.merchantAddress;
      elRecoveryInput.value = config.presets.recoveryAddress;
      elClaimRecipientInput.value = config.presets.merchantAddress;
    }
    elPayerKeyInput.value = config.presets.agentPrivateKey || "";
    elPayerKeyInput.placeholder = "Paste local demo payer key. Server config does not expose private keys.";
    elAccessServiceOrigin.value = BACKEND_URL;
    elAccessServiceAddress.value = config.relayerAddress;
    elAccessScope.value = "GET /api/demo/protected-resource";
    
    applyDashboardMode();
    console.log("Config loaded:", config);
  } catch (err) {
    console.error("Could not fetch config from gateway server:", err);
    alert("Make sure the backend server is running (npm start).");
  }
}

function applyDashboardMode() {
  const capabilities = config.capabilities || {};
  const isArc = config.networkMode === "arc-testnet";
  const publicRelayer = isPublicRelayerMode();
  elNetworkStatus.textContent = isArc
    ? `${publicRelayer ? "Arc Public Relayer Alpha" : "Arc Testnet Read-Only"} (Chain ID: ${config.chainId})`
    : `Local Hardhat Sandbox (Chain ID: ${config.chainId})`;

  elPaycardIdInput.readOnly = !isArc;
  elPaycardIdInput.placeholder = isArc ? "Paste existing Arc Paycard ID (bytes32)" : "0x...";
  elBtnGenerateId.textContent = isArc ? "New / Load" : "New ID";

  elBtnGenerateEnvelope.disabled = false;
  elArcActionStack.classList.toggle("hidden", !isArc);
  elBtnGenerateEnvelope.classList.toggle("hidden", isArc);
  elBtnGenerateEnvelope.textContent = isArc
    ? publicRelayer
      ? "Sign OpenRails Envelope"
      : "Sign and Submit from Wallet"
    : "Generate & Sign Permission Envelope";
  elBtnCreateRequestLink.disabled = !capabilities.canUsePrivateKeySigning && !isArc;
  elBtnSwitchWalletNetwork.classList.toggle("hidden", !isArc);
  elBtnSwitchWalletNetwork.disabled = !isArc;
  elBtnSwitchWalletNetwork.textContent = "Switch/Add Arc Testnet";
  elBtnSubmitRelayer.disabled = !capabilities.canRelayOpen;
  elBtnBlockchainTick.disabled = !capabilities.canTimeTravel;
  elBtnProcessDrip.disabled = !capabilities.canGatewaySettle && !isArc;
  elBtnAutoDrip.disabled = !capabilities.canAutoDrip;
  elBtnFlushDelta.disabled = !capabilities.canDemoFlush && !isArc;
  elBtnMintFaucet.disabled = !capabilities.canMint;
  elBtnIssueAccess.disabled = !config.localSandbox && !isArc;
  elBtnTestAccess.disabled = !config.localSandbox;
  elPayerKeyInput.disabled = !capabilities.canUsePrivateKeySigning;
  elRelayerInputToken.placeholder = isArc
    ? publicRelayer
      ? "Paste a signed envelope for Arc public relayer open..."
      : "Arc testnet mode is read-only. Submit signed transactions from a wallet or approved relayer outside this dashboard."
    : "Paste signed Base64 Permission Envelope bearer token here...";

  elRelayerTitle.textContent = "Pay Stream";
  elRelayerSubtitle.textContent = publicRelayer
    ? "Arc public relayer alpha for capped self-serve stream opens"
    : isArc
      ? "Read-only API plus wallet-submitted Arc transactions"
      : "Local sandbox transaction submission to the Vault";
  elRelayerFlowCopy.innerHTML = publicRelayer
    ? "<strong>Public Relayer Flow:</strong> Users approve USDC and sign the OpenRails envelope. The relayer opens capped testnet streams only. Settlement and close require the payer or recipient wallet."
    : isArc
      ? "<strong>Arc Wallet Flow:</strong> Backend reads state and recovery logs. Your connected wallet submits open, settle, and close transactions."
      : "<strong>Relayer Transaction Flow:</strong> The dashboard submits the off-chain signed envelope to the Gateway. The local relayer submits the transaction to the Vault. Circle Paymaster support is future-facing in this sandbox.";
  elRelayerCapPanel.classList.toggle("hidden", !publicRelayer);
  elRelayerCapCopy.textContent = publicRelayerCapSummary();
  elTesterFlowStatus.innerHTML = publicRelayer
    ? `<strong>Mode:</strong> live read/write public tester flow. Open uses the capped public relayer; settlement and close use your wallet. ${publicRelayerCapSummary()}`
    : isArc
      ? "<strong>Mode:</strong> wallet-signed Arc tester flow. Backend is read-only; all writes use your wallet."
      : "<strong>Mode:</strong> local sandbox tester flow.";

  if (isArc) {
    if (elAllocationInput.value === "1050") elAllocationInput.value = "0.01";
    if (elVelocityInput.value === "5") elVelocityInput.value = "0.0001";
    if (elLifespanInput.value === "120") elLifespanInput.value = "60";
    if (elMetadataRefInput.value === "demo-invoice-001") elMetadataRefInput.value = "manual-smoke-arc";
    setLedgerActionStatus(publicRelayer
      ? `Arc public relayer alpha: open is relayed with caps. ${publicRelayerCapSummary()}`
      : "Arc testnet live mode: local relayer, mint, time travel, and auto drip are disabled. Open, settle, and flush use your connected wallet.");
  }
}

// Format USDC helper (6 decimals)
function formatUSDC(amountString) {
  const num = Number(amountString) / 1000000;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatUSDCPrecise(amountString) {
  const num = Number(amountString) / 1000000;
  const fractionDigits = num > 0 && num < 0.01 ? 6 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 6,
  }).format(num);
}

function getVaultEventAmount(receipt, eventName, amountField) {
  const iface = new ethers.Interface(OPENRAILS_HUB_ABI);
  let total = 0n;
  for (const log of receipt.logs || []) {
    if (log.address?.toLowerCase() !== config.clearinghouseAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === eventName) {
        total += BigInt(parsed.args[amountField].toString());
      }
    } catch {
      // Ignore non-Vault logs in the same transaction.
    }
  }
  return total;
}

function recordTxHash(txHash) {
  if (!txHash || sessionMetrics.txHashes.includes(txHash)) return;
  sessionMetrics.txHashes.unshift(txHash);
  sessionMetrics.txHashes = sessionMetrics.txHashes.slice(0, 5);
}

function updateSessionMetrics() {
  elMetricStreams.textContent = String(sessionMetrics.streamsOpened);
  elMetricEscrowed.textContent = formatUSDCPrecise(sessionMetrics.escrowed.toString());
  elMetricSettled.textContent = formatUSDCPrecise(sessionMetrics.settled.toString());
  elMetricRecovered.textContent = formatUSDCPrecise(sessionMetrics.recovered.toString());
  elMetricReceipts.textContent = String(sessionMetrics.receipts);
  elMetricWallets.textContent = String(sessionMetrics.wallets.size);
  elMetricRecentTx.textContent = sessionMetrics.txHashes.length
    ? `Recent tx: ${sessionMetrics.txHashes[0].slice(0, 10)}...${sessionMetrics.txHashes[0].slice(-8)}`
    : "No session transactions recorded yet.";
}

function updateAgentDecisionTrace(phase, details = {}) {
  const mode = details.mode || elModeInput.value || "railsflow";
  const rail = RAIL_COPY[mode]?.title || (mode === "railsflow" ? "RailsFlow pull request" : "RailsCard value link");
  elAgentTraceSummary.textContent = `${phase}: agent selected ${rail} with bounded Vault enforcement.`;
  const items = [
    `Rail: ${rail}`,
    `Policy budget: ${formatUSDCPrecise((details.allocation || ethers.parseUnits(elAllocationInput.value || "0", 6)).toString())}`,
    `Nonce Lane: ${(details.nonceChannel ?? elNonceChannelInput.value) || "0"}`,
    `Metadata hash: ${(details.metadataHash || elMetadataHashInput.value || "pending").slice(0, 18)}...`,
    `Safety: wallet approval is bounded, Vault enforces settlement and residual recovery.`
  ];
  elAgentTraceList.replaceChildren(...items.map((item) => {
    const row = document.createElement("div");
    row.className = "trace-item";
    row.textContent = item;
    return row;
  }));
}

function updateRailModeGuide() {
  const mode = elModeInput.value;
  elRailModeGuide.textContent = RAIL_COPY[mode]?.guide || RAIL_COPY.railsflow.guide;
  elRailModeGuide.classList.toggle("danger", mode === "railscard_bearer");
}

function renderReceipt(receipt) {
  latestReceipt = receipt;
  sessionMetrics.receipts += 1;
  recordTxHash(receipt.txHash);
  updateSessionMetrics();
  const labels = {
    payment_opened: "Vault Open Receipt",
    settlement_processed: "Settlement Receipt",
    residual_recovered: receipt.recoveryStatus === "no_residual_remaining"
      ? "No-Residual Close Receipt"
      : "Residual Recovery Receipt"
  };
  const workflowLabel = receipt.metadata?.workflowId ? ` Workflow: ${receipt.metadata.workflowId}.` : "";
  const note = receipt.note ? ` ${receipt.note}` : "";
  elReceiptSummary.textContent = `${labels[receipt.type]} generated for ${receipt.paycardId.slice(0, 10)}...${receipt.paycardId.slice(-8)}.${workflowLabel}${note}`;
  elReceiptJsonOutput.textContent = serializeReceipt(receipt);
  elBtnCopyReceipt.disabled = false;
}

function copyReceiptToClipboard() {
  if (!latestReceipt) return;
  navigator.clipboard.writeText(serializeReceipt(latestReceipt)).then(() => {
    const originalText = elBtnCopyReceipt.textContent;
    elBtnCopyReceipt.textContent = "Copied!";
    setTimeout(() => {
      elBtnCopyReceipt.textContent = originalText;
    }, 2000);
  });
}

function setRecoveryStatus(message, isError = false) {
  elRecoveryStatus.textContent = message;
  setActionMessageState(elRecoveryStatus, inferMessageState(message, isError));
}

function buildRecoveredArtifactResult(paycardId, source, details = {}) {
  return {
    paycardId,
    source,
    metadataHash: details.metadataHash || "",
    payer: details.payer || "",
    recipient: details.recipient || "",
    operationalStatus: details.operationalStatus || "",
    blockNumber: details.blockNumber,
  };
}

function extractPaycardFromLocalArtifact(input) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste a receipt, OpenRails link, or envelope first.");

  try {
    const receipt = parseReceipt(trimmed);
    return buildRecoveredArtifactResult(receipt.paycardId, "Receipt", {
      metadataHash: receipt.metadataHash,
      payer: receipt.payer,
      recipient: receipt.recipient,
      blockNumber: receipt.blockNumber,
    });
  } catch {
    // Continue through supported artifact formats.
  }

  try {
    const artifact = parseOpenRailsLink(trimmed);
    const envelopeToken = artifact.payload?.envelopeToken;
    if (!envelopeToken) {
      throw new Error("Unsigned RailsFlow links do not contain a Paycard ID yet.");
    }
    const decoded = deserializeEnvelope(envelopeToken);
    return buildRecoveredArtifactResult(decoded.intent.paycardId, "OpenRails link", {
      metadataHash: decoded.intent.metadataHash,
      payer: decoded.payerAddress,
      recipient: decoded.intent.recipient,
    });
  } catch (err) {
    if (String(err?.message || "").includes("Unsigned RailsFlow links")) throw err;
  }

  const decoded = deserializeEnvelope(trimmed);
  return buildRecoveredArtifactResult(decoded.intent.paycardId, "Envelope", {
    metadataHash: decoded.intent.metadataHash,
    payer: decoded.payerAddress,
    recipient: decoded.intent.recipient,
  });
}

function renderRecoveryResults(results) {
  elRecoveryResults.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "input-helper";
    empty.textContent = "No Paycard IDs recovered.";
    elRecoveryResults.appendChild(empty);
    return;
  }

  for (const result of results) {
    const row = document.createElement("div");
    row.className = "recovery-result";
    const details = document.createElement("div");
    details.className = "recovery-result-details";
    const source = result.source || "Onchain event";
    const payer = result.payer || result.registry?.payer || result.provisioned?.payer || "";
    const recipient = result.recipient || result.registry?.recipient || result.provisioned?.recipient || "";
    const metadataHash = result.metadataHash || result.registry?.metadataHash || result.provisioned?.metadataHash || "";
    const status = result.operationalStatus || result.registry?.operationalStatus || "";
    const blockNumber = result.blockNumber ?? result.provisioned?.blockNumber;
    const title = document.createElement("strong");
    title.textContent = `${source}: ${result.paycardId.slice(0, 10)}...${result.paycardId.slice(-8)}`;
    const statusLine = document.createElement("span");
    statusLine.textContent = `${status ? `${status} · ` : ""}${blockNumber !== undefined ? `block ${blockNumber}` : "local artifact"}`;
    const partyLine = document.createElement("span");
    partyLine.textContent = `Payer ${shortAddress(payer)} · Recipient ${shortAddress(recipient)}`;
    const metadataLine = document.createElement("span");
    metadataLine.textContent = `Metadata ${metadataHash ? `${metadataHash.slice(0, 12)}...${metadataHash.slice(-8)}` : "—"}`;
    details.append(title, statusLine, partyLine, metadataLine);
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "btn-secondary";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => {
      elPaycardIdInput.value = result.paycardId;
      if (metadataHash) elMetadataHashInput.value = metadataHash;
      resetSignedArcEnvelope();
      startPollingPaycard(result.paycardId);
      setRecoveryStatus(`Loaded Paycard ${result.paycardId.slice(0, 10)}...${result.paycardId.slice(-8)}.`);
    });
    row.append(details, loadButton);
    elRecoveryResults.appendChild(row);
  }
}

function recoverPaycardFromArtifact() {
  try {
    const result = extractPaycardFromLocalArtifact(elRecoveryArtifactInput.value);
    renderRecoveryResults([result]);
    setRecoveryStatus(`Recovered Paycard ID from ${result.source}.`);
  } catch (err) {
    renderRecoveryResults([]);
    setRecoveryStatus(`Artifact recovery failed: ${err.message}`, true);
  }
}

function setHistoryStatus(message, isError = false) {
  elHistoryStatus.textContent = message;
  setActionMessageState(elHistoryStatus, inferMessageState(message, isError));
}

function renderStreamHistory(paycardId, state, events) {
  elHistoryResults.replaceChildren();

  if (state) {
    const summary = document.createElement("div");
    summary.className = "recovery-result";
    const details = document.createElement("div");
    details.className = "recovery-result-details";
    const title = document.createElement("strong");
    title.textContent = `Indexed state · ${state.status}`;
    const balanceLine = document.createElement("span");
    balanceLine.textContent = `Available ${formatUSDCPrecise(state.availableBalance)} of ${formatUSDCPrecise(state.totalAllocation)}`;
    const partyLine = document.createElement("span");
    partyLine.textContent = `Payer ${shortAddress(state.payer)} · Recipient ${shortAddress(state.recipient)}`;
    const wfLine = document.createElement("span");
    wfLine.textContent = `Workflow ${state.workflowId || "—"}`;
    details.append(title, balanceLine, partyLine, wfLine);
    summary.appendChild(details);
    elHistoryResults.appendChild(summary);
  }

  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "input-helper";
    empty.textContent = "No indexed events. Make sure the stream gateway is running.";
    elHistoryResults.appendChild(empty);
    return;
  }

  for (const event of events) {
    const row = document.createElement("div");
    row.className = "recovery-result";
    const details = document.createElement("div");
    details.className = "recovery-result-details";
    const title = document.createElement("strong");
    title.textContent = event.eventName;
    const blockLine = document.createElement("span");
    const ts = event.blockTimestamp ? ` · ${new Date(event.blockTimestamp * 1000).toLocaleString()}` : "";
    blockLine.textContent = `block ${event.blockNumber}${ts}`;
    const txLine = document.createElement("span");
    txLine.textContent = `tx ${event.transactionHash ? `${event.transactionHash.slice(0, 10)}...${event.transactionHash.slice(-8)}` : "—"}`;
    details.append(title, blockLine, txLine);
    row.appendChild(details);
    elHistoryResults.appendChild(row);
  }
}

async function loadStreamHistory() {
  const paycardId =
    elHistoryPaycardInput.value.trim() ||
    activePaycard?.paycardId ||
    elPaycardIdInput.value.trim();
  if (!ethers.isHexString(paycardId, 32)) {
    setHistoryStatus("Enter a valid bytes32 Paycard ID (or open a stream first).", true);
    return;
  }
  elHistoryPaycardInput.value = paycardId;
  setHistoryStatus("Loading indexed history...");
  try {
    const res = await fetch(`${BACKEND_URL}/api/streams/${paycardId}/history`);
    if (res.status === 404) {
      renderStreamHistory(paycardId, null, []);
      setHistoryStatus("No indexed history yet. Start the stream gateway and re-open the stream.", true);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderStreamHistory(paycardId, data.state, data.events || []);
    const count = (data.events || []).length;
    setHistoryStatus(`Loaded ${count} indexed event${count === 1 ? "" : "s"}. ${data.disclaimer || ""}`.trim());
  } catch (err) {
    renderStreamHistory(paycardId, null, []);
    setHistoryStatus(`History load failed: ${err.message}`, true);
  }
}

function buildRecoverySearchParams(role, wallet) {
  const params = new URLSearchParams({
    [role]: wallet,
    limit: "20",
  });
  const metadataHash = elRecoveryMetadataInput.value.trim();
  const fromBlock = elRecoveryFromBlockInput.value.trim();
  const toBlock = elRecoveryToBlockInput.value.trim();
  if (metadataHash) params.set("metadataHash", metadataHash);
  if (fromBlock) params.set("fromBlock", fromBlock);
  if (toBlock) params.set("toBlock", toBlock);
  return params;
}

async function recoverPaycardsFromWallet() {
  const wallet = elRecoveryWalletInput.value.trim();
  if (!ethers.isAddress(wallet)) {
    setRecoveryStatus("Enter a valid payer or recipient wallet address.", true);
    return;
  }

  elBtnRecoverWallet.disabled = true;
  elBtnRecoverWallet.textContent = "Searching...";
  setRecoveryStatus("Searching PaycardProvisioned logs by payer and recipient...");
  try {
    const roles = ["payer", "recipient"];
    const combined = new Map();
    for (const role of roles) {
      const res = await fetch(`${BACKEND_URL}/api/paycards/recover?${buildRecoverySearchParams(role, wallet).toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Paycard recovery request failed");
      for (const result of data.results || []) {
        combined.set(result.paycardId.toLowerCase(), {
          ...result,
          source: role === "payer" ? "Onchain payer match" : "Onchain recipient match",
        });
      }
    }
    const results = [...combined.values()].sort((a, b) => (b.provisioned?.blockNumber || 0) - (a.provisioned?.blockNumber || 0));
    renderRecoveryResults(results);
    setRecoveryStatus(results.length ? `Recovered ${results.length} Paycard ID(s).` : "No Paycard IDs matched this wallet.");
  } catch (err) {
    renderRecoveryResults([]);
    setRecoveryStatus(`Onchain recovery failed: ${err.message}`, true);
  } finally {
    elBtnRecoverWallet.disabled = false;
    elBtnRecoverWallet.textContent = "Search Onchain";
  }
}

function renderX402BridgeArtifact(result) {
  const x402 = result.x402 || {};
  const openrails = result.openrails || {};
  elX402BridgeSummary.textContent = `Paid x402 artifact received. Settlement ${x402.settlementId || "pending"} maps to metadata ${openrails.metadataHash || "—"}.`;
  elX402BridgeOutput.textContent = JSON.stringify({
    x402: {
      payer: x402.payer,
      amount: x402.amount,
      network: x402.network,
      settlementId: x402.settlementId,
    },
    openrails: {
      metadataHash: openrails.metadataHash,
      vaultEscrowClaimed: openrails.vaultEscrowClaimed,
      openRailsSettlementStage: openrails.openRailsSettlementStage,
      scope: openrails.scope,
    },
  }, null, 2);
}

async function checkX402BridgeGate() {
  elBtnCheckX402Bridge.disabled = true;
  elBtnCheckX402Bridge.textContent = "Checking...";
  elX402BridgeSummary.textContent = "Checking Circle x402 bridge gate...";
  elX402BridgeOutput.textContent = "";
  try {
    const res = await fetch(`${BACKEND_URL}/api/x402/openrails-artifact`, {
      redirect: "manual",
    });
    const hasPaymentRequired =
      res.headers.has("payment-required") || res.headers.has("Payment-Required");
    if (res.status === 402) {
      elX402BridgeSummary.textContent = hasPaymentRequired
        ? "Payment Required: x402 gate is live and returned payment requirements."
        : "Payment Required: x402 gate responded, but no payment-required header was visible.";
      elX402BridgeOutput.textContent = JSON.stringify({
        status: res.status,
        paymentRequiredHeader: hasPaymentRequired,
        endpoint: "/api/x402/openrails-artifact",
        nextStep: "Use a funded Circle Gateway buyer/browser flow to pay, then capture settlementId.",
        vaultEscrowClaimed: false,
      }, null, 2);
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `x402 bridge check failed with status ${res.status}`);
    }
    renderX402BridgeArtifact(data);
  } catch (err) {
    console.error("x402 bridge check failed:", err);
    elX402BridgeSummary.textContent = `x402 bridge check failed: ${err.message}`;
    elX402BridgeOutput.textContent = JSON.stringify({
      error: err.message,
      endpoint: "/api/x402/openrails-artifact",
    }, null, 2);
  } finally {
    elBtnCheckX402Bridge.disabled = false;
    elBtnCheckX402Bridge.textContent = "Check x402 Bridge Gate";
  }
}

function toggleJudgeScript() {
  elJudgeScriptPanel.classList.toggle("hidden", !elToggleJudgeScript.checked);
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      const entry = value[key];
      return entry === undefined ? "" : `${JSON.stringify(key)}:${canonicalStringify(entry)}`;
    }).filter(Boolean).join(",")}}`;
  }
  return JSON.stringify(value);
}

function base64UrlEncodeJson(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecodeJson(token) {
  let base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  base64 += "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(decodeURIComponent(escape(atob(base64))));
}

function buildOpenRailsLink(path, artifact) {
  const url = new URL(path, window.location.origin);
  url.hash = `or=${base64UrlEncodeJson(artifact)}`;
  return url.toString();
}

function renderQr(text) {
  if (!QRCode) {
    elShareQrCanvas.getContext("2d").clearRect(0, 0, elShareQrCanvas.width, elShareQrCanvas.height);
    return;
  }
  QRCode.toCanvas(elShareQrCanvas, text, {
    margin: 1,
    width: 180,
    errorCorrectionLevel: "M"
  });
}

function buildArtifactReview({ artifact, payload = {}, intent = null, mode = "" }) {
  const selectedMode = mode || payload.mode || intent?.mode || elModeInput.value;
  const amount = payload.amount || intent?.totalAllocationPool || "";
  const velocity = payload.flowVelocityPerSecond || intent?.flowVelocityPerSecond || "";
  const lifespan = payload.lifespanSeconds ?? intent?.lifespanSeconds ?? "";
  const workflowId = payload.workflowId || elWorkflowIdInput.value.trim() || "none";
  const claimRule = selectedMode === "railscard_bearer"
    ? "first holder wins until claimed"
    : selectedMode === "railscard_recipient_bound"
      ? "recipient-bound wallet only"
      : "payer signs before funds move";
  return [
    RAIL_COPY[selectedMode]?.nextStep || "Review terms before sharing or submitting.",
    artifact ? `kind=${artifact.kind}` : `mode=${selectedMode}`,
    artifact ? `chainId=${artifact.chainId}` : `chainId=${config?.chainId ?? "unknown"}`,
    artifact ? `vault=${artifact.vault}` : `vault=${config?.clearinghouseAddress ?? "unknown"}`,
    artifact ? `token=${artifact.token}` : `token=${config?.usdcAddress ?? "unknown"}`,
    `metadataHash=${artifact?.metadataHash || elMetadataHashInput.value || "pending"}`,
    amount ? `amount=${amount}` : "",
    velocity ? `velocity=${velocity}` : "",
    lifespan !== "" ? `lifespanSeconds=${lifespan}` : "",
    `workflowId=${workflowId}`,
    `claimRule=${claimRule}`
  ].filter(Boolean).join("\n");
}

function showShareArtifact({ type, warning, link, dangerous = false, interceptorPreview = "" }) {
  elShareArtifactType.textContent = type;
  elShareArtifactWarning.textContent = warning;
  elShareArtifactWarning.classList.toggle("danger", dangerous);
  elShareArtifactContainer.classList.toggle("danger-review", dangerous);
  elShareLinkOutput.value = link;
  elInterceptorPreview.textContent = interceptorPreview;
  elShareArtifactContainer.classList.remove("hidden");
  renderQr(link);
}

function buildOpenRailsAccessHeaderPreview(_envelopeToken, intent, mode) {
  return [
    "Access credentials are issued after this Paycard Stream is active.",
    "X-OpenRails-Credential-Type: access-v1",
    `X-OpenRails-Paycard-Id: ${intent.paycardId}`,
    `X-OpenRails-Metadata-Hash: ${intent.metadataHash}`,
    `X-OpenRails-Mode: ${mode}`,
    "",
    "Attach only to allowlisted service origins after Vault verification."
  ].join("\n");
}

function readWorkflowId() {
  return elWorkflowIdInput.value.trim();
}

function attachWorkflowId(metadata, payload) {
  const workflowId = readWorkflowId();
  if (workflowId) {
    metadata.workflowId = workflowId;
    if (payload) payload.workflowId = workflowId;
  }
  return metadata;
}

function buildFlushAuthorizationMessage(paycardId) {
  return [
    "OpenRails flush authorization",
    `chainId:${config.chainId}`,
    `hub:${config.clearinghouseAddress}`,
    `paycardId:${paycardId}`,
  ].join("\n");
}

async function handleInboundOpenRailsLink() {
  if (!config || !window.location.hash.includes("or=")) return;
  try {
    const artifact = parseOpenRailsLink(window.location.href);
    validateArtifactAgainstConfig(artifact);
    hydrateInboundArtifact(artifact);
  } catch (err) {
    showInboundLinkReview("Invalid OpenRails link", err.message, true);
  }
}

function validateArtifactAgainstConfig(artifact) {
  if (artifact.chainId !== config.chainId) throw new Error(`Chain mismatch: link ${artifact.chainId}, gateway ${config.chainId}`);
  if (ethers.getAddress(artifact.vault) !== ethers.getAddress(config.clearinghouseAddress)) {
    throw new Error("Vault address mismatch");
  }
  if (ethers.getAddress(artifact.token) !== ethers.getAddress(config.usdcAddress)) {
    throw new Error("Token address mismatch");
  }
}

function hydrateInboundArtifact(artifact) {
  const { payload } = artifact;
  elMetadataHashInput.value = artifact.metadataHash;

  if (artifact.kind === "railsflow" && !payload.envelopeToken) {
    elModeInput.value = "railsflow";
    updateClaimRecipientLock();
    elRecipientInput.value = payload.recipient;
    elAllocationInput.value = ethers.formatUnits(payload.amount, 6);
    elVelocityInput.value = ethers.formatUnits(payload.flowVelocityPerSecond, 6);
    elLifespanInput.value = String(payload.lifespanSeconds);
    elMetadataRefInput.value = payload.metadataRef || "";
    elWorkflowIdInput.value = payload.workflowId || "";
    resetSignedArcEnvelope();
    showInboundLinkReview(
      "Unsigned RailsFlow request loaded",
      "Unsigned RailsFlow request loaded. Review the merchant terms, then sign with wallet or local sandbox key. Nothing is broadcast automatically.",
      false,
      artifact
    );
    document.getElementById("sdk-section").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (payload.envelopeToken) {
    const decoded = deserializeEnvelope(payload.envelopeToken);
    if (decoded.intent.metadataHash !== artifact.metadataHash) {
      throw new Error("Link wrapper metadataHash does not match signed envelope");
    }
    if (payload.mode !== decoded.mode) {
      throw new Error("Link wrapper mode does not match signed envelope");
    }
    elRelayerInputToken.value = payload.envelopeToken;
    elModeInput.value = payload.mode;
    updateClaimRecipientLock();
    elPaycardIdInput.value = decoded.intent.paycardId;
    elMetadataHashInput.value = decoded.intent.metadataHash;
    elAllocationInput.value = ethers.formatUnits(decoded.intent.totalAllocationPool, 6);
    elVelocityInput.value = ethers.formatUnits(decoded.intent.flowVelocityPerSecond, 6);
    elLifespanInput.value = String(decoded.intent.lifespanSeconds);
    elRecipientInput.value = decoded.intent.recipient === ethers.ZeroAddress
      ? config.presets.merchantAddress
      : decoded.intent.recipient;
    elRecoveryInput.value = decoded.intent.residualDeltaRecipient;
    elNonceChannelInput.value = String(decoded.intent.nonceChannel);
    elNonceValueInput.value = String(decoded.intent.nonceValue);
    elMetadataRefInput.value = decoded.metadata?.metadataRef || "";
    elWorkflowIdInput.value = decoded.metadata?.workflowId || "";
    if (payload.mode === "railscard_bearer") {
      elClaimRecipientInput.value = elClaimRecipientInput.value || "";
    } else if (payload.mode === "railscard_recipient_bound") {
      elClaimRecipientInput.value = decoded.intent.recipient;
      elClaimRecipientInput.disabled = true;
    }
    toggleRelayerButton();
    showInboundLinkReview(
      artifact.kind === "railscard" ? "Signed RailsCard link loaded" : "Signed RailsFlow link loaded",
      payload.mode === "railscard_bearer"
        ? "Bearer RailsCard loaded. Treat like cash until claimed: anyone with this unclaimed URL or QR can redeem first. Enter the wallet that should claim it before broadcasting."
        : "Signed envelope loaded. Review terms before explicit broadcast.",
      payload.mode === "railscard_bearer",
      artifact
    );
    document.getElementById("relayer-section").scrollIntoView({ behavior: "smooth" });
  }
}

function showInboundLinkReview(title, detail, dangerous = false, artifact = null) {
  elInboundLinkStatus.textContent = title;
  elInboundLinkStatus.classList.toggle("danger", dangerous);
  elInboundLinkContainer.classList.toggle("danger-review", dangerous);
  elInboundLinkDetails.textContent = artifact
    ? `${detail}\n${buildArtifactReview({ artifact, payload: artifact.payload })}`
    : detail;
  elInboundLinkContainer.classList.remove("hidden");
}

function updateClaimRecipientLock() {
  if (elModeInput.value !== "railscard_recipient_bound") {
    elClaimRecipientInput.disabled = false;
  }
}

function readBearerClaimRecipient() {
  const claimRecipient = elClaimRecipientInput.value.trim();
  if (!ethers.isAddress(claimRecipient) || claimRecipient === ethers.ZeroAddress) {
    throw new Error("Bearer RailsCard needs a non-zero claim recipient before opening. Treat the link like cash until claimed.");
  }
  return claimRecipient;
}

// Refresh treasury wallets
async function refreshBalances() {
  if (!config) return;
  try {
    const addresses = {
      agent: config.presets.agentAddress,
      merchant: config.presets.merchantAddress,
      recovery: config.presets.recoveryAddress,
      contract: config.clearinghouseAddress
    };

    const fetchBalance = async (addr) => {
      if (!addr) return "—";
      const res = await fetch(`${BACKEND_URL}/api/balance/${addr}`);
      const data = await res.json();
      return formatUSDC(data.balance);
    };

    elBalanceAgent.textContent = await fetchBalance(addresses.agent);
    elBalanceMerchant.textContent = await fetchBalance(addresses.merchant);
    elBalanceRecovery.textContent = await fetchBalance(addresses.recovery);
    elBalanceContract.textContent = await fetchBalance(addresses.contract);
  } catch (err) {
    console.error("Error refreshing balances:", err);
  }
}

// Generate an off-chain signed envelope matching the TypeScript SDK schema.
function createRailsFlowRequestArtifact() {
  if (!config) {
    alert("Gateway configuration not loaded. Is the backend server running?");
    return;
  }
  if (elModeInput.value !== "railsflow") {
    alert("Unsigned request links are only for RailsFlow. RailsCard links are payer-signed value links.");
    return;
  }

  const allocationBase = ethers.parseUnits(elAllocationInput.value.toString(), 6).toString();
  const velocityBase = ethers.parseUnits(elVelocityInput.value.toString(), 6).toString();
  const metadataRef = elMetadataRefInput.value.trim() || "openrails-demo";
  const payload = {
    mode: "railsflow",
    merchant: elRecipientInput.value,
    recipient: elRecipientInput.value,
    amount: allocationBase,
    flowVelocityPerSecond: velocityBase,
    lifespanSeconds: Number(elLifespanInput.value),
    metadataRef
  };
  const metadata = attachWorkflowId({
    version: "openrails-metadata-v1",
    mode: "railsflow",
    originator: payload.merchant,
    recipient: payload.recipient,
    token: config.usdcAddress,
    amount: payload.amount,
    flowVelocityPerSecond: payload.flowVelocityPerSecond,
    lifespanSeconds: payload.lifespanSeconds,
    metadataRef
  }, payload);
  const metadataHash = hashOpenRailsMetadata(metadata);
  elMetadataHashInput.value = metadataHash;

  const link = createRailsFlowRequestLink({
    appBaseUrl: window.location.origin,
    chainId: config.chainId,
    vault: config.clearinghouseAddress,
    token: config.usdcAddress,
    metadataHash,
    payload
  });
  showShareArtifact({
    type: RAIL_COPY.railsflow.shareType,
    warning: RAIL_COPY.railsflow.shareWarning,
    link,
    interceptorPreview: buildArtifactReview({
      artifact: {
        kind: "railsflow",
        chainId: config.chainId,
        vault: config.clearinghouseAddress,
        token: config.usdcAddress,
        metadataHash,
        payload
      },
      payload
    })
  });
}

function buildCurrentMetadataAndIntent(payerAddress) {
  const mode = elModeInput.value;
  const allocationBase = ethers.parseUnits(elAllocationInput.value.toString(), 6).toString();
  const velocityBase = ethers.parseUnits(elVelocityInput.value.toString(), 6).toString();
  const signedRecipient = mode === "railscard_bearer" ? ethers.ZeroAddress : elRecipientInput.value;
  const metadataRef = elMetadataRefInput.value.trim() || "openrails-demo";
  const metadata = attachWorkflowId({
    version: "openrails-metadata-v1",
    mode,
    originator: mode === "railsflow" ? elRecipientInput.value : payerAddress,
    recipient: signedRecipient,
    token: config.usdcAddress,
    amount: allocationBase,
    flowVelocityPerSecond: velocityBase,
    lifespanSeconds: Number(elLifespanInput.value),
    metadataRef
  });
  const metadataHash = hashOpenRailsMetadata(metadata);
  const intent = {
    paycardId: elPaycardIdInput.value,
    metadataHash,
    recipient: signedRecipient,
    totalAllocationPool: allocationBase,
    flowVelocityPerSecond: velocityBase,
    genesisTimestamp: Math.floor(Date.now() / 1000),
    lifespanSeconds: Number(elLifespanInput.value),
    residualDeltaRecipient: elRecoveryInput.value,
    nonceChannel: Number(elNonceChannelInput.value),
    nonceValue: Number(elNonceValueInput.value)
  };
  return { metadata, intent, mode };
}

async function prepareArcEnvelopeContext() {
  resetSignedArcEnvelope();
  const signer = await ensureWalletReady();
  const payer = await signer.getAddress();
  const currentNonce = await readNonce(
    browserProvider,
    config.clearinghouseAddress,
    payer,
    Number(elNonceChannelInput.value),
  );
  elNonceValueInput.value = String(currentNonce);
  const { metadata, intent, mode } = buildCurrentMetadataAndIntent(payer);
  elMetadataHashInput.value = intent.metadataHash;
  const claimRecipient = mode === "railscard_bearer" ? readBearerClaimRecipient() : undefined;
  return { signer, payer, metadata, intent, mode, claimRecipient };
}

async function approveArcSpend() {
  try {
    const { signer, payer, intent, mode } = await prepareArcEnvelopeContext();
    updateAgentDecisionTrace("Checking approval", {
      mode,
      allocation: intent.totalAllocationPool,
      nonceChannel: intent.nonceChannel,
      metadataHash: intent.metadataHash
    });
    const balance = await readTokenBalance(browserProvider, config.usdcAddress, payer);
    if (balance < BigInt(intent.totalAllocationPool)) {
      throw new Error(`Insufficient USDC balance. Need ${formatUSDC(intent.totalAllocationPool)}.`);
    }
    const allowance = await readTokenAllowance(
      browserProvider,
      config.usdcAddress,
      payer,
      config.clearinghouseAddress,
    );
    if (allowance >= BigInt(intent.totalAllocationPool)) {
      setLedgerActionStatus("Approval already covers this Paycard allocation.");
      await refreshWalletState();
      return;
    }
    setLedgerActionStatus("Requesting bounded USDC approval in wallet...");
    const approveTx = await approveOpenRailsSpend(
      signer,
      config.usdcAddress,
      config.clearinghouseAddress,
      BigInt(intent.totalAllocationPool),
    );
    showWalletReceipt(approveTx, "Wallet approval submitted to Arc testnet.");
    const receipt = await approveTx.wait();
    elReceiptStatus.textContent = `Mined (Block #${receipt.blockNumber})`;
    setTransactionPanelState("success");
    setLedgerActionStatus("Bounded USDC approval confirmed. Next: sign the OpenRails envelope.");
    await refreshWalletState();
  } catch (err) {
    markWalletReceiptFailed();
    console.error("Arc approval failed:", err);
    setLedgerActionStatus(`Arc approval failed: ${err.message}`, true);
  }
}

async function signArcEnvelope() {
  try {
    const { signer, payer, metadata, intent, mode } = await prepareArcEnvelopeContext();
    const allowance = await readTokenAllowance(
      browserProvider,
      config.usdcAddress,
      payer,
      config.clearinghouseAddress,
    );
    if (allowance < BigInt(intent.totalAllocationPool)) {
      throw new Error("Approve bounded USDC before signing this envelope.");
    }
    updateAgentDecisionTrace("Requesting signature", {
      mode,
      allocation: intent.totalAllocationPool,
      nonceChannel: intent.nonceChannel,
      metadataHash: intent.metadataHash
    });
    setLedgerActionStatus("Requesting EIP-712 OpenRails signature in wallet...");
    latestArcEnvelopeToken = await signPermissionEnvelopeWithSigner(signer, config, intent, {
      mode,
      metadata
    });
    elEnvelopePayloadText.textContent = latestArcEnvelopeToken;
    elEnvelopeOutputContainer.classList.remove("hidden");
    elRelayerInputToken.value = latestArcEnvelopeToken;
    toggleRelayerButton();
    elBtnOpenArcPaycard.disabled = false;
    setLedgerActionStatus(isPublicRelayerMode()
      ? "Envelope signed. Next: open through the public relayer."
      : "Envelope signed. Next: submit from your wallet.");
  } catch (err) {
    console.error("Arc envelope signing failed:", err);
    setLedgerActionStatus(`Arc envelope signing failed: ${err.message}`, true);
  }
}

async function openSignedArcEnvelope() {
  const token = (elRelayerInputToken.value || latestArcEnvelopeToken || "").trim();
  if (!token) {
    setLedgerActionStatus("Sign an OpenRails envelope before opening a Paycard Stream.", true);
    return;
  }
  if (isPublicRelayerMode()) {
    elRelayerInputToken.value = token;
    await broadcastRelayerTx();
    return;
  }

  try {
    const signer = await ensureWalletReady();
    const payer = await signer.getAddress();
    const decoded = deserializeEnvelope(token);
    const mode = decoded.mode || elModeInput.value;
    const claimRecipient = mode === "railscard_bearer" ? readBearerClaimRecipient() : undefined;
    setLedgerActionStatus("Submitting OpenRails transaction from connected wallet...");
    const tx = await submitOpenPaycardWithSigner(
      signer,
      config.clearinghouseAddress,
      token,
      mode,
      claimRecipient,
    );
    showWalletReceipt(tx, "Wallet transaction submitted to Arc testnet.");
    const receipt = await tx.wait();
    elReceiptStatus.textContent = `Mined (Block #${receipt.blockNumber})`;
    setTransactionPanelState("success");
    const recipient = mode === "railscard_bearer" ? claimRecipient : decoded.intent.recipient;
    renderReceipt(createPaymentReceipt({
      chainId: config.chainId,
      hub: config.clearinghouseAddress,
      token: config.usdcAddress,
      paycardId: decoded.intent.paycardId,
      metadataHash: decoded.intent.metadataHash,
      payer,
      recipient,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      totalAllocationPool: decoded.intent.totalAllocationPool,
      flowVelocityPerSecond: decoded.intent.flowVelocityPerSecond,
      lifespanSeconds: decoded.intent.lifespanSeconds,
      residualDeltaRecipient: decoded.intent.residualDeltaRecipient,
      nonceChannel: decoded.intent.nonceChannel,
      nonceValue: decoded.intent.nonceValue,
      metadata: decoded.metadata
    }));
    sessionMetrics.streamsOpened += 1;
    sessionMetrics.escrowed += BigInt(decoded.intent.totalAllocationPool);
    updateSessionMetrics();
    updateAgentDecisionTrace("Opened", {
      mode,
      allocation: decoded.intent.totalAllocationPool,
      nonceChannel: decoded.intent.nonceChannel,
      metadataHash: decoded.intent.metadataHash
    });
    setLedgerActionStatus("OpenRails Paycard Stream opened on Arc testnet.");
    await refreshWalletState();
    startPollingPaycard(decoded.intent.paycardId);
  } catch (err) {
    markWalletReceiptFailed();
    console.error("Arc wallet open failed:", err);
    setLedgerActionStatus(`Arc wallet open failed: ${err.message}`, true);
  }
}

async function submitArcWalletOpen() {
  try {
    const signer = await ensureWalletReady();
    const payer = await signer.getAddress();
    const currentNonce = await readNonce(
      browserProvider,
      config.clearinghouseAddress,
      payer,
      Number(elNonceChannelInput.value),
    );
    elNonceValueInput.value = String(currentNonce);
    const { metadata, intent, mode } = buildCurrentMetadataAndIntent(payer);
    elMetadataHashInput.value = intent.metadataHash;
    const claimRecipient = mode === "railscard_bearer" ? readBearerClaimRecipient() : undefined;
    updateAgentDecisionTrace("Preparing", {
      mode,
      allocation: intent.totalAllocationPool,
      nonceChannel: intent.nonceChannel,
      metadataHash: intent.metadataHash
    });

    const balance = await readTokenBalance(browserProvider, config.usdcAddress, payer);
    if (balance < BigInt(intent.totalAllocationPool)) {
      throw new Error(`Insufficient USDC balance. Need ${formatUSDC(intent.totalAllocationPool)}.`);
    }
    const allowance = await readTokenAllowance(
      browserProvider,
      config.usdcAddress,
      payer,
      config.clearinghouseAddress,
    );
    if (allowance < BigInt(intent.totalAllocationPool)) {
      setLedgerActionStatus("Requesting exact USDC approval in wallet...");
      const approveTx = await approveOpenRailsSpend(
        signer,
        config.usdcAddress,
        config.clearinghouseAddress,
        BigInt(intent.totalAllocationPool),
      );
      await approveTx.wait();
      await refreshWalletState();
    }

    setLedgerActionStatus("Requesting EIP-712 OpenRails signature in wallet...");
    updateAgentDecisionTrace("Requesting signature", {
      mode,
      allocation: intent.totalAllocationPool,
      nonceChannel: intent.nonceChannel,
      metadataHash: intent.metadataHash
    });
    const envelopeToken = await signPermissionEnvelopeWithSigner(signer, config, intent, {
      mode,
      metadata
    });
    elEnvelopePayloadText.textContent = envelopeToken;
    elEnvelopeOutputContainer.classList.remove("hidden");
    elRelayerInputToken.value = envelopeToken;
    toggleRelayerButton();

    if (isPublicRelayerMode()) {
      setLedgerActionStatus("Submitting signed envelope through Arc public relayer...");
      await broadcastRelayerTx();
      return;
    }

    setLedgerActionStatus("Submitting OpenRails transaction from connected wallet...");
    const tx = await submitOpenPaycardWithSigner(
      signer,
      config.clearinghouseAddress,
      envelopeToken,
      mode,
      claimRecipient,
    );
    showWalletReceipt(tx, "Wallet transaction submitted to Arc testnet.");
    const receipt = await tx.wait();
    elReceiptStatus.textContent = `Mined (Block #${receipt.blockNumber})`;
    setTransactionPanelState("success");
    const paymentReceipt = createPaymentReceipt({
      chainId: config.chainId,
      hub: config.clearinghouseAddress,
      token: config.usdcAddress,
      paycardId: intent.paycardId,
      metadataHash: intent.metadataHash,
      payer,
      recipient: mode === "railscard_bearer" ? claimRecipient : intent.recipient,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      totalAllocationPool: intent.totalAllocationPool,
      flowVelocityPerSecond: intent.flowVelocityPerSecond,
      lifespanSeconds: intent.lifespanSeconds,
      residualDeltaRecipient: intent.residualDeltaRecipient,
      nonceChannel: intent.nonceChannel,
      nonceValue: intent.nonceValue,
      metadata
    });
    renderReceipt(paymentReceipt);
    sessionMetrics.streamsOpened += 1;
    sessionMetrics.escrowed += BigInt(intent.totalAllocationPool);
    updateSessionMetrics();
    updateAgentDecisionTrace("Opened", {
      mode,
      allocation: intent.totalAllocationPool,
      nonceChannel: intent.nonceChannel,
      metadataHash: intent.metadataHash
    });
    setLedgerActionStatus("OpenRails Paycard Stream opened on Arc testnet.");
    await refreshWalletState();
    startPollingPaycard(intent.paycardId);
  } catch (err) {
    markWalletReceiptFailed();
    console.error("Arc wallet open failed:", err);
    setLedgerActionStatus(`Arc wallet open failed: ${err.message}`, true);
  }
}

async function generateAndSignEnvelope() {
  if (isArcWalletMode()) {
    await signArcEnvelope();
    return;
  }
  if (!config) {
    alert("Gateway configuration not loaded. Is the backend server running?");
    return;
  }

  const paycardId = elPaycardIdInput.value;
  const allocation = elAllocationInput.value;
  const velocity = elVelocityInput.value;
  const recipient = elRecipientInput.value;
  const recovery = elRecoveryInput.value;
  const lifespan = Number(elLifespanInput.value);
  const mode = elModeInput.value;
  const nonceChannel = Number(elNonceChannelInput.value);
  const nonceValue = Number(elNonceValueInput.value);
  const metadataRef = elMetadataRefInput.value.trim() || "openrails-demo";
  const payerPrivateKey = elPayerKeyInput.value;

  if (!payerPrivateKey.startsWith("0x") || payerPrivateKey.length !== 66) {
    alert("Please enter a valid 32-byte private key hex (starting with 0x).");
    return;
  }

  try {
    // Math conversion to base units (6 decimals)
    const allocationBase = ethers.parseUnits(allocation.toString(), 6).toString();
    const velocityBase = ethers.parseUnits(velocity.toString(), 6).toString();
    const genesisTimestamp = Math.floor(Date.now() / 1000);
    const wallet = new ethers.Wallet(payerPrivateKey);

    const signedRecipient = mode === "railscard_bearer" ? ethers.ZeroAddress : recipient;
    const metadata = attachWorkflowId({
      version: "openrails-metadata-v1",
      mode,
      originator: mode === "railsflow" ? recipient : wallet.address,
      recipient: signedRecipient,
      token: config.usdcAddress,
      amount: allocationBase,
      flowVelocityPerSecond: velocityBase,
      lifespanSeconds: lifespan,
      metadataRef
    });
    const metadataHash = hashOpenRailsMetadata(metadata);
    elMetadataHashInput.value = metadataHash;

    const intent = {
      paycardId,
      metadataHash,
      recipient: signedRecipient,
      totalAllocationPool: allocationBase,
      flowVelocityPerSecond: velocityBase,
      genesisTimestamp,
      lifespanSeconds: lifespan,
      residualDeltaRecipient: recovery,
      nonceChannel,
      nonceValue
    };

    // Reconstruct domain and types
    const domain = {
      name: "OpenRails Network",
      version: "1.0.0",
      chainId: config.chainId,
      verifyingContract: config.clearinghouseAddress,
    };

    const types = {
      SettlementIntent: [
        { name: "paycardId", type: "bytes32" },
        { name: "metadataHash", type: "bytes32" },
        { name: "recipient", type: "address" },
        { name: "totalAllocationPool", type: "uint256" },
        { name: "flowVelocityPerSecond", type: "uint256" },
        { name: "genesisTimestamp", type: "uint256" },
        { name: "lifespanSeconds", type: "uint256" },
        { name: "residualDeltaRecipient", type: "address" },
        { name: "nonceChannel", type: "uint256" },
        { name: "nonceValue", type: "uint256" },
      ],
    };

    // Sign the EIP-712 structured data
    const signature = await wallet.signTypedData(domain, types, intent);

    const completePayload = {
      payerAddress: wallet.address,
      envelopeSignature: signature,
      intent: intent,
      mode,
      metadata
    };

    // Base64 URL-safe conversion
    const base64Token = serializeEnvelope(completePayload);

    // Display output
    elEnvelopePayloadText.textContent = base64Token;
    elEnvelopeOutputContainer.classList.remove("hidden");
    
    // Auto populate relayer input
    elRelayerInputToken.value = base64Token;
    toggleRelayerButton();

    const link = mode === "railsflow"
      ? createRailsFlowRequestLink({
          appBaseUrl: window.location.origin,
          chainId: config.chainId,
          vault: config.clearinghouseAddress,
          token: config.usdcAddress,
          metadataHash,
          payload: {
            mode: "railsflow",
            envelopeToken: base64Token
          }
        })
      : createRailsCardClaimLink({
          appBaseUrl: window.location.origin,
          chainId: config.chainId,
          vault: config.clearinghouseAddress,
          token: config.usdcAddress,
          metadataHash,
          mode,
          envelopeToken: base64Token,
          claimHint: mode === "railscard_bearer" ? "first-holder-wins" : "recipient-bound"
        });
    showShareArtifact({
      type: mode === "railsflow" ? "Signed RailsFlow Envelope Link" : RAIL_COPY[mode].shareType,
      warning: mode === "railscard_bearer"
        ? RAIL_COPY.railscard_bearer.shareWarning
        : mode === "railscard_recipient_bound"
          ? RAIL_COPY.railscard_recipient_bound.shareWarning
          : "Signed RailsFlow envelope. Relayer submission can escrow payer funds under the displayed terms.",
      link,
      dangerous: mode === "railscard_bearer",
      interceptorPreview: [
        buildArtifactReview({
          artifact: {
            kind: mode === "railsflow" ? "railsflow" : "railscard",
            chainId: config.chainId,
            vault: config.clearinghouseAddress,
            token: config.usdcAddress,
            metadataHash,
            payload: { mode, workflowId: metadata.workflowId }
          },
          payload: { mode, workflowId: metadata.workflowId },
          intent
        }),
        "",
        buildOpenRailsAccessHeaderPreview(base64Token, intent, mode)
      ].join("\n")
    });

    // Scroll to relayer section
    document.getElementById("relayer-section").scrollIntoView({ behavior: "smooth" });

  } catch (err) {
    console.error("Signature generation failed:", err);
    alert("Error generating signature: " + err.message);
  }
}

function copyEnvelopeToClipboard() {
  const text = elEnvelopePayloadText.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const originalText = elBtnCopyEnvelope.textContent;
    elBtnCopyEnvelope.textContent = "Copied!";
    setTimeout(() => {
      elBtnCopyEnvelope.textContent = originalText;
    }, 2000);
  });
}

function copyShareLinkToClipboard() {
  const text = elShareLinkOutput.value;
  navigator.clipboard.writeText(text).then(() => {
    const originalText = elBtnCopyShareLink.textContent;
    elBtnCopyShareLink.textContent = "Copied!";
    setTimeout(() => {
      elBtnCopyShareLink.textContent = originalText;
    }, 2000);
  });
}

function toggleRelayerButton() {
  elBtnSubmitRelayer.disabled =
    elRelayerInputToken.value.trim() === "" ||
    config?.capabilities?.canRelayOpen === false;
}

// Broadcast to the local relayer endpoint.
async function broadcastRelayerTx() {
  if (config?.capabilities?.canRelayOpen === false) {
    setLedgerActionStatus("Arc testnet mode is read-only. Submit transactions from a wallet or approved testnet relayer.", true);
    return;
  }
  const token = elRelayerInputToken.value.trim();
  if (!token) return;
  if (token.startsWith("http://") || token.startsWith("https://")) {
    alert("Paste a signed executable envelope token, not a share link. Open the link first, then submit the envelope.");
    return;
  }
  if (elModeInput.value === "railscard_bearer") {
    try {
      readBearerClaimRecipient();
    } catch (err) {
      setLedgerActionStatus(err.message, true);
      return;
    }
  }

  elBtnSubmitRelayer.disabled = true;
  elRelayerStatusContainer.classList.remove("hidden");
  setTransactionPanelState("pending");
  elRelayerStatusLabel.textContent = isPublicRelayerMode()
    ? "Submitting Arc public relayer transaction to the Vault..."
    : "Submitting relayer transaction to the Vault...";
  elReceiptTxLink.textContent = "Processing...";
  elReceiptTxLink.removeAttribute("href");
  elReceiptStatus.textContent = "Pending";
  elReceiptSubmissionMode.textContent = isPublicRelayerMode()
    ? "Arc public relayer alpha"
    : "Local relayer sandbox";
  
  // Scroll to make visible
  elRelayerStatusContainer.scrollIntoView({ behavior: "smooth" });

  try {
    const decodedEnvelope = deserializeEnvelope(token);
    const envelopeMode = decodedEnvelope.mode || elModeInput.value;
    const res = await fetch(`${BACKEND_URL}/api/paycard/open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenRails-Paycard-Id": decodedEnvelope.intent.paycardId,
        "X-OpenRails-Metadata-Hash": decodedEnvelope.intent.metadataHash
      },
      body: JSON.stringify({
        envelopeToken: token,
        mode: envelopeMode,
        claimRecipient: elClaimRecipientInput.value.trim() || undefined
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Broadcast failed");

    // Success
    elRelayerStatusLabel.textContent = `Transaction Confirmed! ${data.mode || "Paycard"} Channel Open.`;
    elReceiptTxLink.textContent = data.txHash;
    elReceiptTxLink.href = config.explorerBaseUrl ? `${config.explorerBaseUrl}/tx/${data.txHash}` : "#";
    elReceiptStatus.textContent = `Mined (Block #${data.blockNumber})`;
    setTransactionPanelState("success");
    const opened = await syncPaycard(data.paycardId);
    if (opened) {
      sessionMetrics.streamsOpened += 1;
      sessionMetrics.escrowed += BigInt(opened.totalAllocationPool);
      renderReceipt(createPaymentReceipt({
        chainId: config.chainId,
        hub: config.clearinghouseAddress,
        token: config.usdcAddress,
        paycardId: opened.paycardId,
        metadataHash: opened.metadataHash,
        payer: opened.payer,
        recipient: opened.recipient,
        txHash: data.txHash,
        blockNumber: data.blockNumber,
        totalAllocationPool: opened.totalAllocationPool,
        flowVelocityPerSecond: opened.flowVelocityPerSecond,
        lifespanSeconds: opened.lifespanSeconds,
        residualDeltaRecipient: opened.residualDeltaRecipient,
        nonceChannel: decodedEnvelope.intent.nonceChannel,
        nonceValue: decodedEnvelope.intent.nonceValue,
        metadata: decodedEnvelope.metadata
      }));
      updateAgentDecisionTrace("Opened", {
        mode: data.mode || elModeInput.value,
        allocation: opened.totalAllocationPool,
        nonceChannel: decodedEnvelope.intent.nonceChannel,
        metadataHash: opened.metadataHash
      });
    }
    
    // Refresh balances and start tracking the paycard
    await refreshBalances();
    startPollingPaycard(data.paycardId);

  } catch (err) {
    console.error("Broadcast failed:", err);
    elRelayerStatusLabel.textContent = "Error broadcasting: " + err.message;
    elReceiptStatus.textContent = "Failed";
    setTransactionPanelState("error");
    elBtnSubmitRelayer.disabled = false;
  }
}

// Poll Paycard registry data from contract
function startPollingPaycard(paycardId) {
  if (isPolling) {
    clearInterval(dripInterval);
  }
  isPolling = true;
  
  elPaycardEmptyState.classList.add("hidden");
  elPaycardActiveState.classList.remove("hidden");
  
  // Start block update polling
  syncPaycard(paycardId);
  dripInterval = setInterval(() => {
    syncPaycard(paycardId);
  }, 3000);
  
  // Local high-speed visual interpolation for the drip progress bar
  runLocalDripAnimation();
  
  document.getElementById("ledger-section").scrollIntoView({ behavior: "smooth" });
}

async function syncPaycard(paycardId) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/paycard/${paycardId}`);
    if (!res.ok) {
      if (res.status === 404) {
        // Not found yet
        return null;
      }
      throw new Error("Failed to query paycard");
    }

    const card = await res.json();
    activePaycard = card;
    hydrateAccessPanel(card);
    
    // Update labels
    elDisplayCardId.textContent = `ID: ${paycardId.substring(0, 8)}...${paycardId.substring(56)}`;
    elDisplayStatus.textContent = card.operationalStatus;
    
    if (card.operationalStatus === "Terminated") {
      elDisplayStatus.className = "card-status-badge terminated";
      clearInterval(dripInterval);
      activePaycard = null;
      isPolling = false;
      stopAutoDrip("Paycard Stream is closed.");
      hydrateAccessPanel(null);
      await refreshBalances();
      
      // Stop animation
      elDisplayFluidFill.style.width = "0%";
      elDisplayAvailableBalance.textContent = "$0.00";
    } else {
      elDisplayStatus.className = "card-status-badge active";
    }

    elDisplayVelocity.textContent = formatUSDCPrecise(card.flowVelocityPerSecond);
    elDisplayAvailableBalance.textContent = formatUSDCPrecise(card.availableBalance);
    const total = Number(card.totalAllocationPool);
    const available = Number(card.availableBalance);
    elDisplayFluidFill.style.width = total > 0 ? `${Math.max(0, Math.min(100, (available / total) * 100))}%` : "0%";
    elDisplayPayer.textContent = `${card.payer.substring(0, 6)}...${card.payer.substring(38)}`;
    elDisplayRecipient.textContent = `${card.recipient.substring(0, 6)}...${card.recipient.substring(38)}`;
    elDisplayRecovery.textContent = `${card.residualDeltaRecipient.substring(0, 6)}...${card.residualDeltaRecipient.substring(38)}`;
    
    // Lifespan remaining
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const expiresAt = card.genesisTimestamp + card.lifespanSeconds;
    const remaining = Math.max(0, expiresAt - currentTimestamp);
    elDisplayLifespan.textContent = `${remaining}s / ${card.lifespanSeconds}s remaining`;

    await refreshBalances();
    return card;

  } catch (err) {
    console.error("Error syncing paycard status:", err);
    return null;
  }
}

// Smooth local UI countdown drip animation between sync ticks
function runLocalDripAnimation() {
  const animate = () => {
    if (!isPolling || !activePaycard) return;
    if (Number(activePaycard.lifespanSeconds) === 0) {
      elDisplayFluidFill.style.width = "100%";
      elDisplayAvailableBalance.textContent = formatUSDCPrecise(activePaycard.availableBalance);
      elDisplayLifespan.textContent = "Instant mode";
      return;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const end = activePaycard.genesisTimestamp + activePaycard.lifespanSeconds;
    
    // Evaluate drip using contract formula
    const lastCheck = activePaycard.lastCheckpointEpoch;
    const evaluatedEpoch = now > end ? end : now;
    
    if (evaluatedEpoch <= lastCheck) {
      // Fluid calculation
      const avail = Number(activePaycard.availableBalance);
      const total = Number(activePaycard.totalAllocationPool);
      const percentage = (avail / total) * 100;
      elDisplayFluidFill.style.width = `${Math.max(0, percentage)}%`;
      elDisplayAvailableBalance.textContent = formatUSDCPrecise(avail.toString());
      requestAnimationFrame(animate);
      return;
    }

    const elapsed = evaluatedEpoch - lastCheck;
    const accrued = elapsed * Number(activePaycard.flowVelocityPerSecond);
    
    let simulatedAvail = Number(activePaycard.availableBalance) - accrued;
    if (simulatedAvail < 0) simulatedAvail = 0;
    
    const total = Number(activePaycard.totalAllocationPool);
    const percentage = (simulatedAvail / total) * 100;
    
    elDisplayFluidFill.style.width = `${Math.max(0, percentage)}%`;
    elDisplayAvailableBalance.textContent = formatUSDCPrecise(simulatedAvail.toString());
    
    // Update time countdown display
    const remaining = Math.max(0, end - now);
    elDisplayLifespan.textContent = `${remaining}s / ${activePaycard.lifespanSeconds}s remaining`;
    
    if (simulatedAvail === 0 || remaining === 0) {
      // Auto triggers sync
      syncPaycard(activePaycard.paycardId);
    }
    
    requestAnimationFrame(animate);
  };
  
  requestAnimationFrame(animate);
}

function hydrateAccessPanel(card) {
  if (!card || card.operationalStatus !== "Active") {
    elAccessPanel.classList.add("hidden");
    return;
  }
  elAccessPanel.classList.remove("hidden");
  elAccessStatus.textContent = "Ready to issue a short-lived OpenRails access credential.";
}

async function issueAccessCredential() {
  if (!activePaycard) {
    elAccessStatus.textContent = "Open an active Paycard Stream first.";
    return;
  }
  const payerPrivateKey = elPayerKeyInput.value.trim();
  if (!payerPrivateKey.startsWith("0x") || payerPrivateKey.length !== 66) {
    elAccessStatus.textContent = "Paste the local demo payer private key first.";
    return;
  }

  try {
    const signer = new ethers.Wallet(payerPrivateKey);
    const issuedAt = Math.floor(Date.now() / 1000);
    const ttl = Math.max(30, Number(elAccessTtl.value || 300));
    const credential = await createOpenRailsAccessCredential(signer, {
      chainId: config.chainId,
      vault: config.clearinghouseAddress,
      paycardId: activePaycard.paycardId,
      metadataHash: activePaycard.metadataHash,
      mode: elModeInput.value,
      service: elAccessServiceAddress.value.trim(),
      serviceOrigin: elAccessServiceOrigin.value.trim(),
      scope: elAccessScope.value.trim(),
      issuedAt,
      expiresAt: issuedAt + ttl
    });
    latestAccessCredentialToken = serializeOpenRailsAccessCredential(credential);
    const headers = buildOpenRailsAccessHeaders(latestAccessCredentialToken);
    elAccessTokenOutput.textContent = latestAccessCredentialToken;
    elAccessHeadersOutput.textContent = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    elAccessStatus.textContent = `Credential expires at ${new Date(credential.expiresAt * 1000).toISOString()}`;
  } catch (err) {
    console.error("Failed to issue access credential:", err);
    elAccessStatus.textContent = `Credential error: ${err.message}`;
  }
}

function copyAccessHeaders() {
  navigator.clipboard.writeText(elAccessHeadersOutput.textContent || "").then(() => {
    const originalText = elBtnCopyAccessHeaders.textContent;
    elBtnCopyAccessHeaders.textContent = "Copied!";
    setTimeout(() => {
      elBtnCopyAccessHeaders.textContent = originalText;
    }, 2000);
  });
}

async function testProtectedAccess() {
  if (!latestAccessCredentialToken) {
    elAccessStatus.textContent = "Issue an access credential first.";
    return;
  }
  try {
    const openRailsFetch = createOpenRailsFetch({
      credential: latestAccessCredentialToken,
      allowedOrigins: [elAccessServiceOrigin.value.trim()]
    });
    const res = await openRailsFetch(`${BACKEND_URL}/api/demo/protected-resource`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Protected request failed");
    elAccessStatus.textContent = `Protected access granted: ${data.message}`;
  } catch (err) {
    console.error("Protected access failed:", err);
    elAccessStatus.textContent = `Protected access failed: ${err.message}`;
  }
}

// EVM Controls via Relayer API
function setLedgerActionStatus(message, isError = false) {
  elLedgerActionStatus.textContent = message;
  setActionMessageState(elLedgerActionStatus, inferMessageState(message, isError));
}

function toggleAutoDrip() {
  if (config?.capabilities?.canAutoDrip === false) {
    setLedgerActionStatus("Auto drip is disabled outside the local Hardhat sandbox.", true);
    return;
  }
  if (autoDripInterval) {
    stopAutoDrip("Auto drip stopped.");
    return;
  }
  if (!activePaycard) {
    setLedgerActionStatus("Open a Paycard Stream before starting auto drip.", true);
    return;
  }
  autoDripInterval = setInterval(runAutoDripStep, 2500);
  elBtnAutoDrip.textContent = "Stop Auto Drip";
  setLedgerActionStatus("Auto drip is running: advancing local time and settling every 2.5s.");
  runAutoDripStep();
}

function stopAutoDrip(message = "Auto drip stopped.") {
  if (autoDripInterval) clearInterval(autoDripInterval);
  autoDripInterval = null;
  autoDripInFlight = false;
  elBtnAutoDrip.textContent = "Auto Drip";
  setLedgerActionStatus(message);
}

async function runAutoDripStep() {
  if (autoDripInFlight || !activePaycard) return;
  autoDripInFlight = true;
  try {
    if (!config.localSandbox) throw new Error("Auto drip uses local Hardhat time travel only.");
    await tickTime({ silent: true });
    if (activePaycard) await processDripSettle({ silent: true });
    if (activePaycard) {
      setLedgerActionStatus(`Auto drip settled ${new Date().toLocaleTimeString()}.`);
    }
  } catch (err) {
    stopAutoDrip(`Auto drip failed: ${err.message}`);
    elLedgerActionStatus.classList.add("danger");
  } finally {
    autoDripInFlight = false;
  }
}

async function tickTime(options = {}) {
  if (config?.capabilities?.canTimeTravel === false) {
    setLedgerActionStatus("Time travel is disabled outside the local Hardhat sandbox.", true);
    return;
  }
  try {
    const res = await fetch(`${BACKEND_URL}/api/blockchain/increase-time`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seconds: 10 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Time travel failed");
    console.log("Blockchain time advanced:", data);
    if (!options.silent) setLedgerActionStatus("Local chain time advanced by 10 seconds.");
    
    if (activePaycard) {
      await syncPaycard(activePaycard.paycardId);
    }
  } catch (err) {
    console.error("Failed to advance blockchain time:", err);
    if (!options.silent) setLedgerActionStatus(`Time travel failed: ${err.message}`, true);
    if (options.silent) throw err;
  }
}

async function processDripSettle(options = {}) {
  if (!activePaycard) return;
  const card = activePaycard;
  const paycardId = activePaycard.paycardId;
  if (isArcWalletMode() && config?.capabilities?.canGatewaySettle !== true) {
    try {
      const signer = await ensureWalletReady();
      updateAgentDecisionTrace("Settling", {
        allocation: card.totalAllocationPool,
        nonceChannel: elNonceChannelInput.value,
        metadataHash: card.metadataHash
      });
      setLedgerActionStatus("Submitting wallet drip settlement...");
      const tx = await submitSettleWithSigner(signer, config.clearinghouseAddress, paycardId);
      showWalletReceipt(tx, "Wallet settlement submitted to Arc testnet.");
      const receipt = await tx.wait();
      elReceiptStatus.textContent = `Mined (Block #${receipt.blockNumber})`;
      setTransactionPanelState("success");
      setLedgerActionStatus("Wallet drip settlement confirmed.");
      const refreshed = await syncPaycard(paycardId);
      const settledAmount = getVaultEventAmount(receipt, "SettlementFlushed", "amountWithdrawn");
      sessionMetrics.settled += settledAmount;
      renderReceipt(createSettlementReceipt({
        chainId: config.chainId,
        hub: config.clearinghouseAddress,
        token: config.usdcAddress,
        paycardId,
        metadataHash: card.metadataHash,
        payer: card.payer,
        recipient: card.recipient,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        settledAmount: settledAmount.toString(),
        remainingAvailableBalance: refreshed?.availableBalance ?? card.availableBalance
      }));
      updateAgentDecisionTrace("Settled", {
        allocation: card.totalAllocationPool,
        nonceChannel: elNonceChannelInput.value,
        metadataHash: card.metadataHash
      });
    } catch (err) {
      markWalletReceiptFailed();
      setLedgerActionStatus(`Wallet drip settlement failed: ${err.message}`, true);
    }
    return;
  }
  if (config?.capabilities?.canGatewaySettle === false) {
    setLedgerActionStatus("Gateway drip settlement is disabled in this mode.", true);
    return;
  }
  try {
    elBtnProcessDrip.disabled = true;
    setLedgerActionStatus(isPublicRelayerMode()
      ? "Submitting settlement through Arc public relayer..."
      : "Submitting gateway drip settlement...");
    const res = await fetch(`${BACKEND_URL}/api/paycard/drip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paycardId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Drip settle failed");
    console.log("Drip settled on-chain:", data);
    if (!options.silent) setLedgerActionStatus("Drip settlement processed.");
    
    const refreshed = await syncPaycard(paycardId);
    const settledAmount = BigInt(data.settledAmount || "0");
    sessionMetrics.settled += settledAmount;
    renderReceipt(createSettlementReceipt({
      chainId: config.chainId,
      hub: config.clearinghouseAddress,
      token: config.usdcAddress,
      paycardId,
      metadataHash: card.metadataHash,
      payer: card.payer,
      recipient: card.recipient,
      txHash: data.txHash,
      blockNumber: data.blockNumber,
      settledAmount: settledAmount.toString(),
      remainingAvailableBalance: refreshed?.availableBalance ?? card.availableBalance
    }));
  } catch (err) {
    console.error("Failed to process drip:", err);
    if (!options.silent) setLedgerActionStatus(`Drip settlement failed: ${err.message}`, true);
    if (options.silent) throw err;
  } finally {
    elBtnProcessDrip.disabled = false;
  }
}

async function flushResidualDelta() {
  if (!activePaycard) return;
  const card = activePaycard;
  const paycardId = card.paycardId;
  if (isArcWalletMode()) {
    try {
      const signer = await ensureWalletReady();
      const signerAddress = await signer.getAddress();
      const isAllowed =
        signerAddress.toLowerCase() === card.payer.toLowerCase() ||
        signerAddress.toLowerCase() === card.recipient.toLowerCase();
      if (!isAllowed) {
        throw new Error("Connected wallet must be the payer or recipient to close this stream.");
      }
      setLedgerActionStatus("Submitting wallet residual recovery...");
      const tx = await submitFlushWithSigner(signer, config.clearinghouseAddress, paycardId);
      showWalletReceipt(tx, "Wallet residual recovery submitted to Arc testnet.");
      const receipt = await tx.wait();
      elReceiptStatus.textContent = `Mined (Block #${receipt.blockNumber})`;
      setTransactionPanelState("success");
      const settledAmount = getVaultEventAmount(receipt, "SettlementFlushed", "amountWithdrawn");
      const recoveredAmount = getVaultEventAmount(receipt, "ResidualDeltaReclaimed", "varianceSwept");
      const noResidual = recoveredAmount === 0n;
      setLedgerActionStatus(noResidual
        ? "Stream closed after final settlement. No STN-Delta residual remained to recover."
        : "Residual recovered and Paycard Stream closed.");
      if (settledAmount > 0n) {
        sessionMetrics.settled += settledAmount;
        renderReceipt(createSettlementReceipt({
          chainId: config.chainId,
          hub: config.clearinghouseAddress,
          token: config.usdcAddress,
          paycardId,
          metadataHash: card.metadataHash,
          payer: card.payer,
          recipient: card.recipient,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          settledAmount: settledAmount.toString(),
          remainingAvailableBalance: recoveredAmount.toString()
        }));
      }
      sessionMetrics.recovered += recoveredAmount;
      renderReceipt(createResidualRecoveryReceipt({
        chainId: config.chainId,
        hub: config.clearinghouseAddress,
        token: config.usdcAddress,
        paycardId,
        metadataHash: card.metadataHash,
        payer: card.payer,
        recipient: card.recipient,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        recoveredAmount: recoveredAmount.toString(),
        recoveryStatus: noResidual ? "no_residual_remaining" : "residual_recovered",
        note: noResidual ? "No STN-Delta residual remained to recover." : undefined
      }));
      updateAgentDecisionTrace(noResidual ? "No residual remaining" : "Residual recovered", {
        allocation: card.totalAllocationPool,
        nonceChannel: elNonceChannelInput.value,
        metadataHash: card.metadataHash
      });
      await syncPaycard(paycardId);
    } catch (err) {
      markWalletReceiptFailed();
      setLedgerActionStatus(`Wallet residual recovery failed: ${err.message}`, true);
    }
    return;
  }
  if (config?.capabilities?.canDemoFlush === false) {
    setLedgerActionStatus("Demo residual flush is disabled in this mode.", true);
    return;
  }
  try {
    elBtnFlushDelta.disabled = true;
    const payerPrivateKey = elPayerKeyInput.value.trim();
    if (!payerPrivateKey) {
      throw new Error("Paste the local demo payer private key before requesting residual recovery.");
    }
    setLedgerActionStatus("Submitting local demo residual recovery...");
    const wallet = new ethers.Wallet(payerPrivateKey);
    const authorizationSignature = await wallet.signMessage(
      buildFlushAuthorizationMessage(paycardId)
    );
    const res = await fetch(`${BACKEND_URL}/api/paycard/flush`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paycardId,
        caller: wallet.address,
        authorizationSignature
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Residual recovery failed");
    console.log("Residual Delta flushed (STN-Delta):", data);
    const recoveredAmount = BigInt(data.recoveredAmount || "0");
    const settledAmount = BigInt(data.settledAmount || "0");
    const noResidual = recoveredAmount === 0n;
    stopAutoDrip(noResidual
      ? "Stream closed after final settlement. No STN-Delta residual remained to recover."
      : "Residual recovered and Paycard Stream closed.");
    if (settledAmount > 0n) {
      sessionMetrics.settled += settledAmount;
      renderReceipt(createSettlementReceipt({
        chainId: config.chainId,
        hub: config.clearinghouseAddress,
        token: config.usdcAddress,
        paycardId,
        metadataHash: card.metadataHash,
        payer: card.payer,
        recipient: card.recipient,
        txHash: data.txHash,
        blockNumber: data.blockNumber,
        settledAmount: settledAmount.toString(),
        remainingAvailableBalance: recoveredAmount.toString()
      }));
    }
    sessionMetrics.recovered += recoveredAmount;
    renderReceipt(createResidualRecoveryReceipt({
      chainId: config.chainId,
      hub: config.clearinghouseAddress,
      token: config.usdcAddress,
      paycardId,
      metadataHash: card.metadataHash,
      payer: card.payer,
      recipient: card.recipient,
      txHash: data.txHash,
      blockNumber: data.blockNumber,
      recoveredAmount: recoveredAmount.toString(),
      recoveryStatus: noResidual ? "no_residual_remaining" : "residual_recovered",
      note: noResidual ? "No STN-Delta residual remained to recover." : undefined
    }));
    
    await syncPaycard(paycardId);
  } catch (err) {
    console.error("Failed to flush residual delta:", err);
    setLedgerActionStatus(`Residual recovery failed: ${err.message}`, true);
  } finally {
    elBtnFlushDelta.disabled = false;
  }
}

async function mintFaucetUSDC() {
  if (config?.capabilities?.canMint === false) {
    setLedgerActionStatus("Demo mint is disabled in Arc testnet read-only mode.", true);
    return;
  }
  if (!config) return;
  try {
    elBtnMintFaucet.disabled = true;
    const res = await fetch(`${BACKEND_URL}/api/usdc/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: config.presets.agentAddress,
        amount: 100
      })
    });
    await res.json();
    await refreshBalances();
    console.log("Minted $100 USDC to Agent wallet.");
  } catch (err) {
    console.error("Failed to mint USDC:", err);
  } finally {
    elBtnMintFaucet.disabled = false;
  }
}

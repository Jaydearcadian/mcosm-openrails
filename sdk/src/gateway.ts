import { ethers } from "ethers";

export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

const GATEWAY_WALLET_ABI = [
  "function deposit(address token, uint256 value) external",
  "function depositFor(address token, address depositor, uint256 value) external",
  "function totalBalance(address token, address depositor) external view returns (uint256)",
  "function availableBalance(address token, address depositor) external view returns (uint256)"
] as const;

const GATEWAY_MINTER_ABI = [
  "function gatewayMint(bytes calldata attestationPayload, bytes calldata signature) external"
] as const;

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
] as const;

export interface DepositParams {
  signer: ethers.Signer;
  amountBaseUnits: bigint; // USDC 6-decimal units (mwei)
  tokenAddress?: string; // defaults to Arc USDC
  gatewayWalletAddress?: string; // override for local or test deployments
  autoApprove?: boolean; // automatically submit approve transaction if allowance is insufficient
}

export interface DepositForParams extends DepositParams {
  depositor: string;
}

export interface MintParams {
  signer: ethers.Signer;
  attestationPayload: string; // hex string
  signature: string; // hex string
  gatewayMinterAddress?: string; // override for local or test deployments
}

function nonZeroAddress(value: string, field: string): string {
  if (!ethers.isAddress(value) || ethers.getAddress(value) === ethers.ZeroAddress) {
    throw new Error(`${field} must be a non-zero EVM address`);
  }
  return ethers.getAddress(value);
}

function positiveAmount(value: bigint): bigint {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error("amountBaseUnits must be a positive bigint");
  }
  return value;
}

function nonEmptyHex(value: string, field: string): string {
  if (!ethers.isHexString(value) || value === "0x") {
    throw new Error(`${field} must be non-empty hex data`);
  }
  return value;
}

async function confirmedHash(transaction: ethers.TransactionResponse, operation: string): Promise<string> {
  const receipt = await transaction.wait();
  if (!receipt) throw new Error(`${operation} did not return a transaction receipt`);
  return receipt.hash;
}

/**
 * Deposits USDC (or another supported token) to the Circle Gateway Wallet.
 */
export async function depositToGateway(params: DepositParams): Promise<{ txHash: string }> {
  const amountBaseUnits = positiveAmount(params.amountBaseUnits);
  const token = nonZeroAddress(params.tokenAddress || ARC_USDC_ADDRESS, "tokenAddress");
  const gatewayWallet = nonZeroAddress(params.gatewayWalletAddress || GATEWAY_WALLET_ADDRESS, "gatewayWalletAddress");
  const signerAddress = nonZeroAddress(await params.signer.getAddress(), "signer address");

  if (params.autoApprove !== false) {
    const erc20 = new ethers.Contract(token, ERC20_ABI, params.signer);
    const allowance = await erc20.allowance(signerAddress, gatewayWallet);
    if (allowance < amountBaseUnits) {
      console.log(`[Gateway] Insufficient allowance (${allowance.toString()}). Approving ${amountBaseUnits.toString()}...`);
      const approveTx = await erc20.approve(gatewayWallet, amountBaseUnits);
      await approveTx.wait();
    }
  }

  const contract = new ethers.Contract(gatewayWallet, GATEWAY_WALLET_ABI, params.signer);
  const tx = await contract.deposit(token, amountBaseUnits);
  return { txHash: await confirmedHash(tx, "Gateway deposit") };
}

/**
 * Deposits USDC (or another supported token) to the Circle Gateway Wallet on behalf of another address.
 */
export async function depositForToGateway(params: DepositForParams): Promise<{ txHash: string }> {
  const amountBaseUnits = positiveAmount(params.amountBaseUnits);
  const token = nonZeroAddress(params.tokenAddress || ARC_USDC_ADDRESS, "tokenAddress");
  const gatewayWallet = nonZeroAddress(params.gatewayWalletAddress || GATEWAY_WALLET_ADDRESS, "gatewayWalletAddress");
  const depositor = nonZeroAddress(params.depositor, "depositor");
  const signerAddress = nonZeroAddress(await params.signer.getAddress(), "signer address");

  if (params.autoApprove !== false) {
    const erc20 = new ethers.Contract(token, ERC20_ABI, params.signer);
    const allowance = await erc20.allowance(signerAddress, gatewayWallet);
    if (allowance < amountBaseUnits) {
      console.log(`[Gateway] Insufficient allowance (${allowance.toString()}). Approving ${amountBaseUnits.toString()}...`);
      const approveTx = await erc20.approve(gatewayWallet, amountBaseUnits);
      await approveTx.wait();
    }
  }

  const contract = new ethers.Contract(gatewayWallet, GATEWAY_WALLET_ABI, params.signer);
  const tx = await contract.depositFor(token, depositor, amountBaseUnits);
  return { txHash: await confirmedHash(tx, "Gateway third-party deposit") };
}

/**
 * Submits an attestation payload and signature to the Gateway Minter to mint tokens.
 */
export async function mintFromGateway(params: MintParams): Promise<{ txHash: string }> {
  const attestationPayload = nonEmptyHex(params.attestationPayload, "attestationPayload");
  const signature = nonEmptyHex(params.signature, "signature");
  const gatewayMinter = nonZeroAddress(params.gatewayMinterAddress || GATEWAY_MINTER_ADDRESS, "gatewayMinterAddress");
  const contract = new ethers.Contract(gatewayMinter, GATEWAY_MINTER_ABI, params.signer);
  const tx = await contract.gatewayMint(attestationPayload, signature);
  return { txHash: await confirmedHash(tx, "Gateway mint") };
}

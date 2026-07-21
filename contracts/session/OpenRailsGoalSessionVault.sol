// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IOpenRailsSessionHub {
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function openPaycardChannel(
        bytes32 paycardId,
        bytes32 metadataHash,
        address recipient,
        uint256 totalAllocationPool,
        uint256 flowVelocityPerSecond,
        uint256 genesisTimestamp,
        uint256 lifespanSeconds,
        address residualDeltaRecipient,
        bytes calldata envelopeSignature,
        uint256 nonceChannel,
        uint256 nonceValue,
        address payer
    ) external;
}

/**
 * @notice A funded, enforceable Goal Session that acts as the EIP-1271 payer for child streams.
 * The owner funds the vault; the delegated agent may reserve child intents within cumulative policy.
 * A child intent is only valid while opened through this contract, preventing direct-Hub bypass.
 */
contract OpenRailsGoalSessionVault is IERC1271 {
    using SafeERC20 for IERC20;

    bytes4 internal constant MAGICVALUE = IERC1271.isValidSignature.selector;
    bytes32 internal constant SETTLEMENT_INTENT_TYPEHASH = keccak256(
        "SettlementIntent(bytes32 paycardId,bytes32 metadataHash,address recipient,uint256 totalAllocationPool,uint256 flowVelocityPerSecond,uint256 genesisTimestamp,uint256 lifespanSeconds,address residualDeltaRecipient,uint256 nonceChannel,uint256 nonceValue)"
    );

    address public immutable owner;
    address public immutable agent;
    IERC20 public immutable token;
    IOpenRailsSessionHub public immutable hub;
    uint256 public immutable maximumAllocation;
    uint256 public immutable maximumVelocityPerSecond;
    uint256 public immutable validUntil;
    address public immutable allowedRecipient;

    uint256 public committedAllocation;
    bool public halted;
    bytes32 private activeDigest;

    struct Authorization {
        uint256 allocation;
        bytes signature;
        bool reserved;
        bool consumed;
    }

    mapping(bytes32 => Authorization) public authorizations;

    event SessionFunded(uint256 amount);
    event IntentReserved(bytes32 indexed digest, uint256 allocation);
    event IntentOpened(bytes32 indexed digest, bytes32 indexed paycardId);
    event SessionHalted();

    error AccessViolation();
    error SessionInactive();
    error PolicyViolation();
    error InvalidAuthorization();

    constructor(
        address owner_,
        address agent_,
        address token_,
        address hub_,
        uint256 maximumAllocation_,
        uint256 maximumVelocityPerSecond_,
        uint256 validUntil_,
        address allowedRecipient_
    ) {
        if (
            owner_ == address(0) || agent_ == address(0) || token_ == address(0) || hub_ == address(0)
                || maximumAllocation_ == 0 || maximumVelocityPerSecond_ == 0
                || (validUntil_ != 0 && validUntil_ <= block.timestamp)
        ) revert PolicyViolation();

        owner = owner_;
        agent = agent_;
        token = IERC20(token_);
        hub = IOpenRailsSessionHub(hub_);
        maximumAllocation = maximumAllocation_;
        maximumVelocityPerSecond = maximumVelocityPerSecond_;
        validUntil = validUntil_;
        allowedRecipient = allowedRecipient_;

        IERC20(token_).forceApprove(hub_, type(uint256).max);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert AccessViolation();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert AccessViolation();
        _;
    }

    function fund(uint256 amount) external {
        if (msg.sender != owner) revert AccessViolation();
        token.safeTransferFrom(owner, address(this), amount);
        emit SessionFunded(amount);
    }

    function halt() external onlyOwner {
        halted = true;
        emit SessionHalted();
    }

    function reserveIntent(
        bytes32 digest,
        uint256 allocation,
        uint256 velocityPerSecond,
        address recipient,
        bytes calldata agentSignature
    ) external onlyAgent {
        if (!_active()) revert SessionInactive();
        if (digest == bytes32(0) || allocation == 0 || velocityPerSecond == 0) revert PolicyViolation();
        if (velocityPerSecond > maximumVelocityPerSecond) revert PolicyViolation();
        if (allowedRecipient != address(0) && recipient != allowedRecipient) revert PolicyViolation();
        if (committedAllocation + allocation > maximumAllocation) revert PolicyViolation();
        if (ECDSA.recover(digest, agentSignature) != agent) revert InvalidAuthorization();

        Authorization storage auth = authorizations[digest];
        if (auth.reserved) revert InvalidAuthorization();
        auth.allocation = allocation;
        auth.signature = agentSignature;
        auth.reserved = true;
        committedAllocation += allocation;
        emit IntentReserved(digest, allocation);
    }

    function openAuthorized(
        bytes32 paycardId,
        bytes32 metadataHash,
        address recipient,
        uint256 totalAllocationPool,
        uint256 flowVelocityPerSecond,
        uint256 genesisTimestamp,
        uint256 lifespanSeconds,
        uint256 nonceChannel,
        uint256 nonceValue
    ) external onlyAgent {
        if (!_active()) revert SessionInactive();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                hub.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        SETTLEMENT_INTENT_TYPEHASH,
                        paycardId,
                        metadataHash,
                        recipient,
                        totalAllocationPool,
                        flowVelocityPerSecond,
                        genesisTimestamp,
                        lifespanSeconds,
                        owner,
                        nonceChannel,
                        nonceValue
                    )
                )
            )
        );

        Authorization storage auth = authorizations[digest];
        if (!auth.reserved || auth.consumed || auth.allocation != totalAllocationPool) revert InvalidAuthorization();

        activeDigest = digest;
        hub.openPaycardChannel(
            paycardId,
            metadataHash,
            recipient,
            totalAllocationPool,
            flowVelocityPerSecond,
            genesisTimestamp,
            lifespanSeconds,
            owner,
            auth.signature,
            nonceChannel,
            nonceValue,
            address(this)
        );
        activeDigest = bytes32(0);
        auth.consumed = true;
        emit IntentOpened(digest, paycardId);
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        Authorization storage auth = authorizations[hash];
        if (
            hash == activeDigest && auth.reserved && !auth.consumed
                && keccak256(signature) == keccak256(auth.signature)
                && ECDSA.recover(hash, signature) == agent
        ) return MAGICVALUE;
        return 0xffffffff;
    }

    function remainingAllocation() external view returns (uint256) {
        return maximumAllocation - committedAllocation;
    }

    function _active() internal view returns (bool) {
        return !halted && (validUntil == 0 || block.timestamp <= validUntil);
    }
}

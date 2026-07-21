// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

contract SessionMockHub {
    bytes32 public immutable DOMAIN_SEPARATOR;
    IERC20 public immutable token;

    bytes32 private constant TYPEHASH = keccak256(
        "SettlementIntent(bytes32 paycardId,bytes32 metadataHash,address recipient,uint256 totalAllocationPool,uint256 flowVelocityPerSecond,uint256 genesisTimestamp,uint256 lifespanSeconds,address residualDeltaRecipient,uint256 nonceChannel,uint256 nonceValue)"
    );

    mapping(bytes32 => address) public payerOf;

    constructor(address token_) {
        token = IERC20(token_);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("OpenRails Network"),
                keccak256("2.0.0"),
                block.chainid,
                address(this)
            )
        );
    }

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
    ) external {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        TYPEHASH,
                        paycardId,
                        metadataHash,
                        recipient,
                        totalAllocationPool,
                        flowVelocityPerSecond,
                        genesisTimestamp,
                        lifespanSeconds,
                        residualDeltaRecipient,
                        nonceChannel,
                        nonceValue
                    )
                )
            )
        );
        require(IERC1271(payer).isValidSignature(digest, envelopeSignature) == IERC1271.isValidSignature.selector, "invalid session signature");
        require(token.transferFrom(payer, address(this), totalAllocationPool), "funding failed");
        payerOf[paycardId] = payer;
    }
}

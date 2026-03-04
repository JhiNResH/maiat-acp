// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MaiatReceiptResolver
 * @notice EAS Schema Resolver — only allows Maiat's wallet to create attestations.
 *         Any attestation created through this resolver is a verified "Maiat Receipt".
 *
 * @dev Implements the ISchemaResolver interface used by EAS on Base.
 *      When registered as a schema resolver, EAS calls `attest()` before finalizing
 *      any attestation. This contract rejects attestations from non-Maiat addresses.
 *
 * @custom:security-audit
 *   - Only EAS contract can call attest/multiAttest
 *   - Only maiatAttester can create receipts
 *   - Non-revocable (revoke always returns false)
 *   - Zero-address validation on constructor and admin functions
 *   - No ETH accepted (isPayable = false, payable functions reject ETH)
 */

// Minimal EAS types
struct Attestation {
    bytes32 uid;
    bytes32 schema;
    uint64 time;
    uint64 expirationTime;
    uint64 revocationTime;
    bytes32 refUID;
    address recipient;
    address attester;
    bool revocable;
    bytes data;
}

interface IEAS {
    function getAttestation(bytes32 uid) external view returns (Attestation memory);
}

contract MaiatReceiptResolver {
    /// @notice The EAS contract address on Base
    address public immutable eas;

    /// @notice The Maiat attester wallet — only this address can create receipts
    address public maiatAttester;

    /// @notice The contract owner (can update maiatAttester)
    address public owner;

    /// @notice Total number of receipts issued
    uint256 public receiptCount;

    // ── Events ────────────────────────────────────────────────────────────

    /// @notice Emitted when a Maiat Receipt is created
    event MaiatReceiptIssued(bytes32 indexed uid, address indexed recipient, address indexed attester, uint64 time);

    /// @notice Emitted when the Maiat attester is updated
    event AttesterUpdated(address indexed oldAttester, address indexed newAttester);

    /// @notice Emitted when ownership is transferred
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── Errors ────────────────────────────────────────────────────────────

    error OnlyEAS();
    error NotMaiatAttester();
    error NotOwner();
    error ZeroAddress();

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyEAS() {
        if (msg.sender != eas) revert OnlyEAS();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _eas, address _maiatAttester) {
        if (_eas == address(0)) revert ZeroAddress();
        if (_maiatAttester == address(0)) revert ZeroAddress();
        eas = _eas;
        maiatAttester = _maiatAttester;
        owner = msg.sender;
    }

    // ── ISchemaResolver interface ─────────────────────────────────────────

    /// @notice Called by EAS before creating an attestation
    /// @return true if the attestation is from the Maiat attester
    function attest(Attestation calldata attestation) external payable onlyEAS returns (bool) {
        if (msg.value > 0) revert(); // No ETH accepted
        if (attestation.attester != maiatAttester) revert NotMaiatAttester();

        receiptCount++;
        emit MaiatReceiptIssued(attestation.uid, attestation.recipient, attestation.attester, attestation.time);

        return true;
    }

    /// @notice Called by EAS when revoking — Maiat Receipts are non-revocable
    function revoke(Attestation calldata) external payable returns (bool) {
        return false; // Maiat Receipts cannot be revoked
    }

    /// @notice Multi-attest support
    function multiAttest(Attestation[] calldata attestations, uint256[] calldata)
        external
        payable
        onlyEAS
        returns (bool)
    {
        if (msg.value > 0) revert(); // No ETH accepted
        for (uint256 i = 0; i < attestations.length; i++) {
            if (attestations[i].attester != maiatAttester) revert NotMaiatAttester();
            receiptCount++;
            emit MaiatReceiptIssued(
                attestations[i].uid, attestations[i].recipient, attestations[i].attester, attestations[i].time
            );
        }
        return true;
    }

    /// @notice Multi-revoke — always rejects
    function multiRevoke(Attestation[] calldata, uint256[] calldata) external payable returns (bool) {
        return false;
    }

    /// @notice This resolver does not require payment
    function isPayable() external pure returns (bool) {
        return false;
    }

    // ── Public verification ───────────────────────────────────────────────

    /// @notice Verify that a given attestation UID is a valid Maiat Receipt
    /// @param uid The EAS attestation UID to verify
    /// @return valid True if the attestation exists and was attested by Maiat
    function isMaiatReceipt(bytes32 uid) external view returns (bool valid) {
        Attestation memory a = IEAS(eas).getAttestation(uid);
        return a.attester == maiatAttester && a.time > 0;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /// @notice Update the Maiat attester address
    function setAttester(address _newAttester) external onlyOwner {
        if (_newAttester == address(0)) revert ZeroAddress();
        emit AttesterUpdated(maiatAttester, _newAttester);
        maiatAttester = _newAttester;
    }

    /// @notice Transfer ownership
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }
}

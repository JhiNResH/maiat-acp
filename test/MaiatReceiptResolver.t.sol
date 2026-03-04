// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MaiatReceiptResolver.sol";

/// @dev Mock EAS contract for testing
contract MockEAS {
    mapping(bytes32 => Attestation) private _attestations;

    function setAttestation(bytes32 uid, Attestation memory attestation) external {
        _attestations[uid] = attestation;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return _attestations[uid];
    }
}

contract MaiatReceiptResolverTest is Test {
    MaiatReceiptResolver resolver;
    MockEAS mockEAS;

    address owner = address(this);
    address maiatAttester = address(0xBEEF);
    address nonAttester = address(0xDEAD);
    address randomUser = address(0x1234);

    event MaiatReceiptIssued(bytes32 indexed uid, address indexed recipient, address indexed attester, uint64 time);
    event AttesterUpdated(address indexed oldAttester, address indexed newAttester);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        mockEAS = new MockEAS();
        resolver = new MaiatReceiptResolver(address(mockEAS), maiatAttester);
    }

    // ── Constructor ───────────────────────────────────────────────────────

    function test_constructor_setsCorrectValues() public view {
        assertEq(resolver.eas(), address(mockEAS));
        assertEq(resolver.maiatAttester(), maiatAttester);
        assertEq(resolver.owner(), owner);
        assertEq(resolver.receiptCount(), 0);
    }

    function test_constructor_revertsOnZeroEAS() public {
        vm.expectRevert(MaiatReceiptResolver.ZeroAddress.selector);
        new MaiatReceiptResolver(address(0), maiatAttester);
    }

    function test_constructor_revertsOnZeroAttester() public {
        vm.expectRevert(MaiatReceiptResolver.ZeroAddress.selector);
        new MaiatReceiptResolver(address(mockEAS), address(0));
    }

    // ── attest ─────────────────────────────────────────────────────────

    function _buildAttestation(address attester) internal view returns (Attestation memory) {
        return Attestation({
            uid: bytes32(uint256(1)),
            schema: bytes32(uint256(2)),
            time: uint64(block.timestamp),
            expirationTime: 0,
            revocationTime: 0,
            refUID: bytes32(0),
            recipient: address(0x9999),
            attester: attester,
            revocable: false,
            data: ""
        });
    }

    function test_attest_success() public {
        Attestation memory att = _buildAttestation(maiatAttester);

        vm.prank(address(mockEAS));
        bool result = resolver.attest(att);

        assertTrue(result);
        assertEq(resolver.receiptCount(), 1);
    }

    function test_attest_emitsEvent() public {
        Attestation memory att = _buildAttestation(maiatAttester);

        vm.expectEmit(true, true, true, true);
        emit MaiatReceiptIssued(att.uid, att.recipient, att.attester, att.time);

        vm.prank(address(mockEAS));
        resolver.attest(att);
    }

    function test_attest_revertsOnNonEAS() public {
        Attestation memory att = _buildAttestation(maiatAttester);

        vm.prank(randomUser);
        vm.expectRevert(MaiatReceiptResolver.OnlyEAS.selector);
        resolver.attest(att);
    }

    function test_attest_revertsOnNonMaiatAttester() public {
        Attestation memory att = _buildAttestation(nonAttester);

        vm.prank(address(mockEAS));
        vm.expectRevert(MaiatReceiptResolver.NotMaiatAttester.selector);
        resolver.attest(att);
    }

    function test_attest_revertsOnETHSent() public {
        Attestation memory att = _buildAttestation(maiatAttester);

        vm.deal(address(mockEAS), 1 ether);
        vm.prank(address(mockEAS));
        vm.expectRevert();
        resolver.attest{value: 1 wei}(att);
    }

    function test_attest_incrementsReceiptCount() public {
        vm.startPrank(address(mockEAS));
        for (uint256 i = 0; i < 5; i++) {
            Attestation memory att = _buildAttestation(maiatAttester);
            att.uid = bytes32(i + 1);
            resolver.attest(att);
        }
        vm.stopPrank();
        assertEq(resolver.receiptCount(), 5);
    }

    // ── revoke ────────────────────────────────────────────────────────────

    function test_revoke_alwaysReturnsFalse() public {
        Attestation memory att = _buildAttestation(maiatAttester);

        vm.prank(address(mockEAS));
        bool result = resolver.revoke(att);
        assertFalse(result);
    }

    // ── multiAttest ───────────────────────────────────────────────────────

    function test_multiAttest_success() public {
        Attestation[] memory atts = new Attestation[](3);
        for (uint256 i = 0; i < 3; i++) {
            atts[i] = _buildAttestation(maiatAttester);
            atts[i].uid = bytes32(i + 1);
        }

        uint256[] memory values = new uint256[](3);

        vm.prank(address(mockEAS));
        bool result = resolver.multiAttest(atts, values);

        assertTrue(result);
        assertEq(resolver.receiptCount(), 3);
    }

    function test_multiAttest_revertsOnNonMaiatAttester() public {
        Attestation[] memory atts = new Attestation[](2);
        atts[0] = _buildAttestation(maiatAttester);
        atts[1] = _buildAttestation(nonAttester);

        uint256[] memory values = new uint256[](2);

        vm.prank(address(mockEAS));
        vm.expectRevert(MaiatReceiptResolver.NotMaiatAttester.selector);
        resolver.multiAttest(atts, values);
    }

    function test_multiAttest_revertsOnNonEAS() public {
        Attestation[] memory atts = new Attestation[](1);
        atts[0] = _buildAttestation(maiatAttester);
        uint256[] memory values = new uint256[](1);

        vm.prank(randomUser);
        vm.expectRevert(MaiatReceiptResolver.OnlyEAS.selector);
        resolver.multiAttest(atts, values);
    }

    // ── multiRevoke ───────────────────────────────────────────────────────

    function test_multiRevoke_alwaysReturnsFalse() public {
        Attestation[] memory atts = new Attestation[](1);
        atts[0] = _buildAttestation(maiatAttester);
        uint256[] memory values = new uint256[](1);

        bool result = resolver.multiRevoke(atts, values);
        assertFalse(result);
    }

    // ── isPayable ─────────────────────────────────────────────────────────

    function test_isPayable_returnsFalse() public view {
        assertFalse(resolver.isPayable());
    }

    // ── isMaiatReceipt ────────────────────────────────────────────────────

    function test_isMaiatReceipt_returnsTrue() public {
        bytes32 uid = bytes32(uint256(42));
        Attestation memory att = _buildAttestation(maiatAttester);
        att.uid = uid;
        att.time = uint64(block.timestamp);

        mockEAS.setAttestation(uid, att);
        assertTrue(resolver.isMaiatReceipt(uid));
    }

    function test_isMaiatReceipt_returnsFalseForNonMaiat() public {
        bytes32 uid = bytes32(uint256(42));
        Attestation memory att = _buildAttestation(nonAttester);
        att.uid = uid;
        att.time = uint64(block.timestamp);

        mockEAS.setAttestation(uid, att);
        assertFalse(resolver.isMaiatReceipt(uid));
    }

    function test_isMaiatReceipt_returnsFalseForZeroTime() public {
        bytes32 uid = bytes32(uint256(42));
        Attestation memory att = _buildAttestation(maiatAttester);
        att.uid = uid;
        att.time = 0;

        mockEAS.setAttestation(uid, att);
        assertFalse(resolver.isMaiatReceipt(uid));
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function test_setAttester_success() public {
        address newAttester = address(0xCAFE);

        vm.expectEmit(true, true, false, false);
        emit AttesterUpdated(maiatAttester, newAttester);

        resolver.setAttester(newAttester);
        assertEq(resolver.maiatAttester(), newAttester);
    }

    function test_setAttester_revertsOnZeroAddress() public {
        vm.expectRevert(MaiatReceiptResolver.ZeroAddress.selector);
        resolver.setAttester(address(0));
    }

    function test_setAttester_revertsOnNonOwner() public {
        vm.prank(randomUser);
        vm.expectRevert(MaiatReceiptResolver.NotOwner.selector);
        resolver.setAttester(address(0xCAFE));
    }

    function test_transferOwnership_success() public {
        address newOwner = address(0xCAFE);

        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, newOwner);

        resolver.transferOwnership(newOwner);
        assertEq(resolver.owner(), newOwner);
    }

    function test_transferOwnership_revertsOnZeroAddress() public {
        vm.expectRevert(MaiatReceiptResolver.ZeroAddress.selector);
        resolver.transferOwnership(address(0));
    }

    // ── Fuzz Tests ────────────────────────────────────────────────────────

    function testFuzz_attest_onlyEASCanCall(address caller) public {
        vm.assume(caller != address(mockEAS));
        Attestation memory att = _buildAttestation(maiatAttester);

        vm.prank(caller);
        vm.expectRevert(MaiatReceiptResolver.OnlyEAS.selector);
        resolver.attest(att);
    }

    function testFuzz_attest_onlyMaiatCanAttest(address attester) public {
        vm.assume(attester != maiatAttester);
        Attestation memory att = _buildAttestation(attester);

        vm.prank(address(mockEAS));
        vm.expectRevert(MaiatReceiptResolver.NotMaiatAttester.selector);
        resolver.attest(att);
    }

    function testFuzz_receiptCount_alwaysIncreases(uint8 count) public {
        vm.assume(count > 0 && count <= 50);

        vm.startPrank(address(mockEAS));
        for (uint8 i = 0; i < count; i++) {
            Attestation memory att = _buildAttestation(maiatAttester);
            att.uid = bytes32(uint256(i + 1));
            resolver.attest(att);
        }
        vm.stopPrank();

        assertEq(resolver.receiptCount(), count);
    }

    function testFuzz_onlyOwnerCanAdmin(address caller) public {
        vm.assume(caller != owner);
        vm.prank(caller);
        vm.expectRevert(MaiatReceiptResolver.NotOwner.selector);
        resolver.setAttester(address(0xCAFE));
    }

    function testFuzz_isMaiatReceipt_validatesAttester(address attester, uint64 time) public {
        vm.assume(time > 0);
        bytes32 uid = bytes32(uint256(99));
        Attestation memory att = _buildAttestation(attester);
        att.uid = uid;
        att.time = time;

        mockEAS.setAttestation(uid, att);

        if (attester == maiatAttester) {
            assertTrue(resolver.isMaiatReceipt(uid));
        } else {
            assertFalse(resolver.isMaiatReceipt(uid));
        }
    }
}

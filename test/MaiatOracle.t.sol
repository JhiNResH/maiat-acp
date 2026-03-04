// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/MaiatOracle.sol";

contract MaiatOracleTest is Test {
    MaiatOracle oracle;
    address owner = address(this);
    address operator = address(0xBEEF);
    address agent1 = address(0x1111);
    address agent2 = address(0x2222);
    address agent3 = address(0x3333);
    address nonOperator = address(0xDEAD);

    event ScoreUpdated(address indexed agent, uint8 score, string verdict, uint256 indexed jobId, string offering);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        oracle = new MaiatOracle(operator);
    }

    // ── Constructor ───────────────────────────────────────────────────────

    function test_constructor_setsOwnerAndOperator() public view {
        assertEq(oracle.owner(), owner);
        assertEq(oracle.operator(), operator);
    }

    function test_constructor_revertsOnZeroOperator() public {
        vm.expectRevert(MaiatOracle.ZeroAddress.selector);
        new MaiatOracle(address(0));
    }

    // ── updateScore ───────────────────────────────────────────────────────

    function test_updateScore_success() public {
        vm.prank(operator);
        oracle.updateScore(agent1, 85, "proceed", 1001, "agent_trust");

        (uint8 score, string memory verdict, uint64 updatedAt) = oracle.getTrustScore(agent1);
        assertEq(score, 85);
        assertEq(verdict, "proceed");
        assertGt(updatedAt, 0);
        assertTrue(oracle.hasScore(agent1));
        assertEq(oracle.updateCount(), 1);
        assertEq(oracle.getScoredAgentCount(), 1);
        assertEq(oracle.getScoredAgent(0), agent1);
    }

    function test_updateScore_emitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ScoreUpdated(agent1, 72, "caution", 1002, "agent_deep_check");

        vm.prank(operator);
        oracle.updateScore(agent1, 72, "caution", 1002, "agent_deep_check");
    }

    function test_updateScore_revertsOnNonOperator() public {
        vm.prank(nonOperator);
        vm.expectRevert(MaiatOracle.NotOperator.selector);
        oracle.updateScore(agent1, 85, "proceed", 1001, "agent_trust");
    }

    function test_updateScore_revertsOnZeroAddress() public {
        vm.prank(operator);
        vm.expectRevert(MaiatOracle.ZeroAddress.selector);
        oracle.updateScore(address(0), 85, "proceed", 1001, "agent_trust");
    }

    function test_updateScore_revertsOnScoreAbove100() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MaiatOracle.ScoreTooHigh.selector, 101, 100));
        oracle.updateScore(agent1, 101, "proceed", 1001, "agent_trust");
    }

    function test_updateScore_overwritesPreviousScore() public {
        vm.startPrank(operator);
        oracle.updateScore(agent1, 85, "proceed", 1001, "agent_trust");
        oracle.updateScore(agent1, 30, "avoid", 1002, "agent_deep_check");
        vm.stopPrank();

        (uint8 score, string memory verdict,) = oracle.getTrustScore(agent1);
        assertEq(score, 30);
        assertEq(verdict, "avoid");
        // Agent should only be in scoredAgents once
        assertEq(oracle.getScoredAgentCount(), 1);
        assertEq(oracle.updateCount(), 2);
    }

    function test_updateScore_multipleAgents() public {
        vm.startPrank(operator);
        oracle.updateScore(agent1, 85, "proceed", 1001, "agent_trust");
        oracle.updateScore(agent2, 45, "caution", 1002, "agent_trust");
        oracle.updateScore(agent3, 10, "avoid", 1003, "agent_trust");
        vm.stopPrank();

        assertEq(oracle.getScoredAgentCount(), 3);
        assertEq(oracle.updateCount(), 3);
    }

    function test_updateScore_boundaryValues() public {
        vm.startPrank(operator);
        oracle.updateScore(agent1, 0, "avoid", 1, "agent_trust");
        (uint8 s0,,) = oracle.getTrustScore(agent1);
        assertEq(s0, 0);

        oracle.updateScore(agent1, 100, "proceed", 2, "agent_trust");
        (uint8 s100,,) = oracle.getTrustScore(agent1);
        assertEq(s100, 100);
        vm.stopPrank();
    }

    // ── batchUpdateScores ─────────────────────────────────────────────────

    function test_batchUpdateScores_success() public {
        address[] memory agents = new address[](2);
        agents[0] = agent1;
        agents[1] = agent2;

        uint8[] memory _scores = new uint8[](2);
        _scores[0] = 80;
        _scores[1] = 50;

        string[] memory verdicts = new string[](2);
        verdicts[0] = "proceed";
        verdicts[1] = "caution";

        uint256[] memory jobIds = new uint256[](2);
        jobIds[0] = 1001;
        jobIds[1] = 1002;

        string[] memory offerings = new string[](2);
        offerings[0] = "agent_trust";
        offerings[1] = "agent_deep_check";

        vm.prank(operator);
        oracle.batchUpdateScores(agents, _scores, verdicts, jobIds, offerings);

        assertEq(oracle.getScoredAgentCount(), 2);
        assertEq(oracle.updateCount(), 2);

        (uint8 score1,,) = oracle.getTrustScore(agent1);
        (uint8 score2,,) = oracle.getTrustScore(agent2);
        assertEq(score1, 80);
        assertEq(score2, 50);
    }

    function test_batchUpdateScores_revertsOnMismatch() public {
        address[] memory agents = new address[](2);
        agents[0] = agent1;
        agents[1] = agent2;
        uint8[] memory _scores = new uint8[](1);
        _scores[0] = 80;

        vm.prank(operator);
        vm.expectRevert(MaiatOracle.ArrayLengthMismatch.selector);
        oracle.batchUpdateScores(agents, _scores, new string[](2), new uint256[](2), new string[](2));
    }

    function test_batchUpdateScores_revertsOnScoreAbove100() public {
        address[] memory agents = new address[](1);
        agents[0] = agent1;
        uint8[] memory _scores = new uint8[](1);
        _scores[0] = 200;

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MaiatOracle.ScoreTooHigh.selector, 200, 100));
        oracle.batchUpdateScores(agents, _scores, new string[](1), new uint256[](1), new string[](1));
    }

    // ── Read functions ────────────────────────────────────────────────────

    function test_getTrustScore_returnsZeroForUnscored() public view {
        (uint8 score, string memory verdict, uint64 updatedAt) = oracle.getTrustScore(agent1);
        assertEq(score, 0);
        assertEq(verdict, "");
        assertEq(updatedAt, 0);
    }

    function test_hasScore_returnsFalseForUnscored() public view {
        assertFalse(oracle.hasScore(agent1));
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function test_setOperator_success() public {
        address newOp = address(0xCAFE);

        vm.expectEmit(true, true, false, false);
        emit OperatorUpdated(operator, newOp);

        oracle.setOperator(newOp);
        assertEq(oracle.operator(), newOp);
    }

    function test_setOperator_revertsOnNonOwner() public {
        vm.prank(nonOperator);
        vm.expectRevert(MaiatOracle.NotOwner.selector);
        oracle.setOperator(address(0xCAFE));
    }

    function test_setOperator_revertsOnZeroAddress() public {
        vm.expectRevert(MaiatOracle.ZeroAddress.selector);
        oracle.setOperator(address(0));
    }

    function test_transferOwnership_success() public {
        address newOwner = address(0xCAFE);

        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, newOwner);

        oracle.transferOwnership(newOwner);
        assertEq(oracle.owner(), newOwner);
    }

    function test_transferOwnership_revertsOnZeroAddress() public {
        vm.expectRevert(MaiatOracle.ZeroAddress.selector);
        oracle.transferOwnership(address(0));
    }

    function test_transferOwnership_revertsOnNonOwner() public {
        vm.prank(nonOperator);
        vm.expectRevert(MaiatOracle.NotOwner.selector);
        oracle.transferOwnership(address(0xCAFE));
    }

    // ── Fuzz Tests ────────────────────────────────────────────────────────

    function testFuzz_updateScore_boundedScore(uint8 score) public {
        vm.assume(score <= 100);
        vm.prank(operator);
        oracle.updateScore(agent1, score, "test", 1, "agent_trust");

        (uint8 result,,) = oracle.getTrustScore(agent1);
        assertEq(result, score);
    }

    function testFuzz_updateScore_revertsAboveMax(uint8 score) public {
        vm.assume(score > 100);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MaiatOracle.ScoreTooHigh.selector, score, 100));
        oracle.updateScore(agent1, score, "test", 1, "agent_trust");
    }

    function testFuzz_updateScore_anyAgent(address agent) public {
        vm.assume(agent != address(0));
        vm.prank(operator);
        oracle.updateScore(agent, 50, "caution", 1, "agent_trust");

        assertTrue(oracle.hasScore(agent));
        (uint8 score,,) = oracle.getTrustScore(agent);
        assertEq(score, 50);
    }

    function testFuzz_updateScore_anyJobId(uint256 jobId) public {
        vm.prank(operator);
        oracle.updateScore(agent1, 75, "proceed", jobId, "agent_trust");
        assertEq(oracle.updateCount(), 1);
    }

    function testFuzz_updateScore_preservesInvariant_updateCountMatchesActions(uint8 count) public {
        vm.assume(count > 0 && count <= 50);
        vm.startPrank(operator);
        for (uint8 i = 0; i < count; i++) {
            oracle.updateScore(address(uint160(i + 1)), i % 101, "test", uint256(i), "agent_trust");
        }
        vm.stopPrank();
        assertEq(oracle.updateCount(), count);
    }

    function testFuzz_onlyOperatorCanWrite(address caller) public {
        vm.assume(caller != operator);
        vm.prank(caller);
        vm.expectRevert(MaiatOracle.NotOperator.selector);
        oracle.updateScore(agent1, 50, "test", 1, "test");
    }

    function testFuzz_onlyOwnerCanAdmin(address caller) public {
        vm.assume(caller != owner);
        vm.prank(caller);
        vm.expectRevert(MaiatOracle.NotOwner.selector);
        oracle.setOperator(address(0xCAFE));
    }
}

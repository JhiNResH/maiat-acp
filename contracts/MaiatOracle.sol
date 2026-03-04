// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MaiatOracle
 * @notice On-chain trust score oracle for ACP agents.
 *         Only Maiat can write scores. Any contract or EOA can read.
 *
 * @dev Designed for the ACP/agent ecosystem on Base.
 *      Other protocols can use `getTrustScore(agent)` to make trust-based decisions.
 *
 * @custom:security-audit
 *   - Only operator can write (onlyOperator modifier)
 *   - Score validated to 0-100 range on-chain
 *   - Zero-address checks on constructor/admin
 *   - scoredAgents array is append-only (no deletion)
 *   - Batch update validates array length parity
 */
contract MaiatOracle {
    struct TrustRecord {
        uint8 score; // 0-100 trust score
        string verdict; // "proceed" | "caution" | "avoid" | "unknown"
        uint64 updatedAt; // Block timestamp of last update
        uint256 jobId; // ACP job ID that produced this score
        string offering; // Which offering was used (agent_trust, agent_deep_check, etc.)
    }

    /// @notice Maximum allowed score value
    uint8 public constant MAX_SCORE = 100;

    /// @notice Contract owner (can update operator)
    address public owner;

    /// @notice The Maiat operator wallet — only this address can write scores
    address public operator;

    /// @notice Agent address → latest trust record
    mapping(address => TrustRecord) public scores;

    /// @notice List of all agents that have been scored
    address[] public scoredAgents;
    mapping(address => bool) private _hasScore;

    /// @notice Total number of score updates
    uint256 public updateCount;

    // ── Events ────────────────────────────────────────────────────────────

    event ScoreUpdated(address indexed agent, uint8 score, string verdict, uint256 indexed jobId, string offering);

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── Errors ────────────────────────────────────────────────────────────

    error NotOperator();
    error NotOwner();
    error ZeroAddress();
    error ScoreTooHigh(uint8 score, uint8 max);
    error ArrayLengthMismatch();

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    constructor(address _operator) {
        if (_operator == address(0)) revert ZeroAddress();
        owner = msg.sender;
        operator = _operator;
    }

    // ── Write (Maiat only) ────────────────────────────────────────────────

    /// @notice Update the trust score for an agent
    /// @param agent The agent wallet address
    /// @param score Trust score (0-100)
    /// @param verdict Trust verdict string
    /// @param jobId ACP job ID that produced this score
    /// @param offering Name of the offering used
    function updateScore(address agent, uint8 score, string calldata verdict, uint256 jobId, string calldata offering)
        external
        onlyOperator
    {
        if (agent == address(0)) revert ZeroAddress();
        if (score > MAX_SCORE) revert ScoreTooHigh(score, MAX_SCORE);

        scores[agent] = TrustRecord({
            score: score,
            verdict: verdict,
            updatedAt: uint64(block.timestamp),
            jobId: jobId,
            offering: offering
        });

        if (!_hasScore[agent]) {
            scoredAgents.push(agent);
            _hasScore[agent] = true;
        }

        updateCount++;
        emit ScoreUpdated(agent, score, verdict, jobId, offering);
    }

    /// @notice Batch update scores
    function batchUpdateScores(
        address[] calldata agents,
        uint8[] calldata _scores,
        string[] calldata verdicts,
        uint256[] calldata jobIds,
        string[] calldata offerings
    ) external onlyOperator {
        if (
            agents.length != _scores.length || agents.length != verdicts.length || agents.length != jobIds.length
                || agents.length != offerings.length
        ) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < agents.length; i++) {
            if (agents[i] == address(0)) revert ZeroAddress();
            if (_scores[i] > MAX_SCORE) revert ScoreTooHigh(_scores[i], MAX_SCORE);

            scores[agents[i]] = TrustRecord({
                score: _scores[i],
                verdict: verdicts[i],
                updatedAt: uint64(block.timestamp),
                jobId: jobIds[i],
                offering: offerings[i]
            });

            if (!_hasScore[agents[i]]) {
                scoredAgents.push(agents[i]);
                _hasScore[agents[i]] = true;
            }

            updateCount++;
            emit ScoreUpdated(agents[i], _scores[i], verdicts[i], jobIds[i], offerings[i]);
        }
    }

    // ── Read (anyone) ─────────────────────────────────────────────────────

    /// @notice Get the latest trust score for an agent
    /// @return score Trust score (0-100), 0 if never scored
    /// @return verdict Trust verdict string, empty if never scored
    /// @return updatedAt Timestamp of last update, 0 if never scored
    function getTrustScore(address agent)
        external
        view
        returns (uint8 score, string memory verdict, uint64 updatedAt)
    {
        TrustRecord memory record = scores[agent];
        return (record.score, record.verdict, record.updatedAt);
    }

    /// @notice Check if an agent has been scored
    function hasScore(address agent) external view returns (bool) {
        return _hasScore[agent];
    }

    /// @notice Get the total number of scored agents
    function getScoredAgentCount() external view returns (uint256) {
        return scoredAgents.length;
    }

    /// @notice Get a scored agent by index
    function getScoredAgent(uint256 index) external view returns (address) {
        return scoredAgents[index];
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /// @notice Update the operator address
    function setOperator(address _newOperator) external onlyOwner {
        if (_newOperator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, _newOperator);
        operator = _newOperator;
    }

    /// @notice Transfer ownership
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }
}

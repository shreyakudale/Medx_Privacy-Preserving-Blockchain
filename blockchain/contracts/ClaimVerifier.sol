// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MedicalDataExchange.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[6] calldata _pubSignals
    ) external view returns (bool);
}

/**
 * @title ClaimVerifier
 * @notice Verifies zero-knowledge proofs that a patient's hospital-signed
 *         credential satisfies a condition (minimum age, vaccination status)
 *         without revealing the underlying attributes.
 *
 * Public signals (order fixed by the circuit):
 *   [0] issuerAx  [1] issuerAy  [2] subject (patient address)
 *   [3] currentYear  [4] minAge  [5] requireVaccinated
 */
contract ClaimVerifier {
    IGroth16Verifier public immutable groth16;
    MedicalDataExchange public immutable registry;

    struct Verification {
        address patient;
        address issuer;
        address verifiedBy;
        uint16 minAge;
        bool requireVaccinated;
        uint16 year;
        uint64 verifiedAt;
    }

    uint256 public verificationCount;
    mapping(uint256 => Verification) public verifications;

    event ClaimVerified(
        uint256 indexed verificationId,
        address indexed patient,
        address indexed verifiedBy,
        address issuer,
        uint16 minAge,
        bool requireVaccinated,
        uint16 year
    );

    error InvalidProof();
    error UntrustedIssuer();
    error StaleYear();
    error BadSignal();

    constructor(address groth16_, address registry_) {
        groth16 = IGroth16Verifier(groth16_);
        registry = MedicalDataExchange(registry_);
    }

    function currentYear() public view returns (uint256) {
        // Average Gregorian year length; accurate to within a day, which the ±1 tolerance absorbs.
        return 1970 + block.timestamp / 31556952;
    }

    /// @notice Read-only check. Returns the issuing hospital and patient on success; reverts otherwise.
    function check(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[6] calldata pub
    ) public view returns (address issuer, address patient) {
        issuer = registry.issuerFor(pub[0], pub[1]);
        if (issuer == address(0)) revert UntrustedIssuer();

        if (pub[2] > type(uint160).max) revert BadSignal();
        patient = address(uint160(pub[2]));

        uint256 y = currentYear();
        if (pub[3] + 1 < y || pub[3] > y + 1) revert StaleYear();
        if (pub[4] > 150 || pub[5] > 1) revert BadSignal();

        if (!groth16.verifyProof(a, b, c, pub)) revert InvalidProof();
    }

    /// @notice Verifies the proof and records the verification on-chain for the audit trail.
    function verifyAndRecord(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[6] calldata pub
    ) external returns (uint256 id) {
        (address issuer, address patient) = check(a, b, c, pub);
        id = ++verificationCount;
        verifications[id] = Verification({
            patient: patient,
            issuer: issuer,
            verifiedBy: msg.sender,
            minAge: uint16(pub[4]),
            requireVaccinated: pub[5] == 1,
            year: uint16(pub[3]),
            verifiedAt: uint64(block.timestamp)
        });
        emit ClaimVerified(id, patient, msg.sender, issuer, uint16(pub[4]), pub[5] == 1, uint16(pub[3]));
    }
}

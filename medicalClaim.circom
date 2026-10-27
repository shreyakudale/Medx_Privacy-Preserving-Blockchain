pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/eddsaposeidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/*
 * MedicalClaim
 *
 * A trusted hospital (issuer) signs a credential:
 *     msg = Poseidon(subject, birthYear, vaccinated)
 * with its Baby Jubjub EdDSA key.
 *
 * The patient proves, without revealing birthYear or vaccinated:
 *   1. the credential was signed by the issuer whose public key is public input
 *   2. the credential belongs to `subject` (the patient's wallet address)
 *   3. currentYear - birthYear >= minAge
 *   4. if requireVaccinated == 1, then vaccinated == 1
 *
 * Public inputs (in this order in publicSignals):
 *   issuerAx, issuerAy, subject, currentYear, minAge, requireVaccinated
 */
template MedicalClaim() {
    // ---- public ----
    signal input issuerAx;
    signal input issuerAy;
    signal input subject;
    signal input currentYear;
    signal input minAge;
    signal input requireVaccinated;

    // ---- private ----
    signal input birthYear;
    signal input vaccinated;
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;

    // Range checks so the comparison cannot wrap around the field
    component byBits = Num2Bits(16);  byBits.in <== birthYear;
    component cyBits = Num2Bits(16);  cyBits.in <== currentYear;
    component maBits = Num2Bits(8);   maBits.in <== minAge;

    // Boolean checks
    vaccinated * (vaccinated - 1) === 0;
    requireVaccinated * (requireVaccinated - 1) === 0;

    // 1 + 2: credential signature over (subject, birthYear, vaccinated)
    component h = Poseidon(3);
    h.inputs[0] <== subject;
    h.inputs[1] <== birthYear;
    h.inputs[2] <== vaccinated;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax  <== issuerAx;
    sig.Ay  <== issuerAy;
    sig.R8x <== sigR8x;
    sig.R8y <== sigR8y;
    sig.S   <== sigS;
    sig.M   <== h.out;

    // 3: birthYear + minAge <= currentYear
    component ageOk = LessEqThan(17);
    ageOk.in[0] <== birthYear + minAge;
    ageOk.in[1] <== currentYear;
    ageOk.out === 1;

    // 4: requireVaccinated => vaccinated
    requireVaccinated * (1 - vaccinated) === 0;
}

component main { public [issuerAx, issuerAy, subject, currentYear, minAge, requireVaccinated] } = MedicalClaim();

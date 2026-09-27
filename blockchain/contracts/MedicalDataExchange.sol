// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MedicalDataExchange
 * @notice Patient-controlled consent and access management for encrypted,
 *         off-chain medical records.
 *
 * What lives on-chain:  content hash of the encrypted file, an opaque storage
 *                       reference, pseudonymous ownership (wallet address),
 *                       consent requests, time-limited grants, emergency
 *                       settings and an audit trail of gateway access events.
 * What never lives here: the medical file, its decryption key, or any
 *                       plaintext medical attribute.
 */
contract MedicalDataExchange {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    enum Role { None, Patient, Doctor, Hospital }
    enum RequestStatus { None, Pending, Approved, Rejected, Cancelled }

    struct Participant {
        Role role;
        bool verified;               // patients: always true; doctors: set by hospital; hospitals: set by admin
        string name;                 // display name (use a pseudonym for patients)
        string encryptionPublicKey;  // RSA-OAEP public key (JWK string) used to wrap record keys
        address hospital;            // doctor's affiliated hospital
        uint64 registeredAt;
    }

    struct Record {
        address owner;
        bytes32 contentHash;         // SHA-256 of the encrypted file
        string storageRef;           // opaque off-chain reference (IPFS CID or storage id)
        string category;             // e.g. "Lab report" - keep generic to limit leakage
        uint64 createdAt;
        bool active;
    }

    struct AccessRequest {
        uint256 recordId;
        address requester;
        uint32 durationSeconds;
        uint64 createdAt;
        RequestStatus status;
        string purpose;
    }

    struct Grant {
        uint64 expiresAt;
        bool emergency;
    }

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    uint32 public constant MAX_GRANT_DURATION = 30 days;
    uint32 public constant EMERGENCY_DURATION = 6 hours;

    address public admin;
    address public gateway;

    mapping(address => Participant) public participants;

    // issuer key hash => hospital address (0 if not trusted)
    mapping(bytes32 => address) public issuerHospital;
    mapping(address => bytes32) public hospitalIssuerKey;

    uint256 public recordCount;
    mapping(uint256 => Record) public records;
    mapping(address => uint256[]) private _patientRecords;

    uint256 public requestCount;
    mapping(uint256 => AccessRequest) public requests;

    mapping(uint256 => mapping(address => Grant)) public grants;
    mapping(uint256 => mapping(address => bool)) public emergencyAllowed;
    mapping(uint256 => uint256) public accessCount;

    // ------------------------------------------------------------------
    // Events (indexed by patient so dashboards can filter cheaply)
    // ------------------------------------------------------------------
    event ParticipantRegistered(address indexed account, Role role, string name);
    event DoctorVerified(address indexed doctor, address indexed hospital);
    event EncryptionKeyUpdated(address indexed account);
    event IssuerKeySet(address indexed hospital, uint256 ax, uint256 ay);
    event IssuerKeyRevoked(address indexed hospital);
    event GatewayUpdated(address indexed gateway);

    event RecordAdded(uint256 indexed recordId, address indexed owner, bytes32 contentHash, string category);
    event RecordDeactivated(uint256 indexed recordId, address indexed owner);

    event AccessRequested(uint256 indexed requestId, uint256 indexed recordId, address indexed owner, address requester, uint32 durationSeconds, string purpose);
    event RequestRejected(uint256 indexed requestId, uint256 indexed recordId, address indexed owner, address requester);
    event RequestCancelled(uint256 indexed requestId, uint256 indexed recordId, address indexed owner, address requester);
    event AccessGranted(uint256 indexed recordId, address indexed owner, address indexed grantee, uint64 expiresAt, bool emergency);
    event AccessRevoked(uint256 indexed recordId, address indexed owner, address indexed grantee);

    event EmergencyAccessConfigured(uint256 indexed recordId, address indexed owner, address indexed hospital, bool allowed);
    event EmergencyAccessUsed(uint256 indexed recordId, address indexed owner, address indexed hospital, string reason, uint64 expiresAt);

    event RecordAccessed(uint256 indexed recordId, address indexed owner, address indexed accessor, uint64 timestamp);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error NotAdmin();
    error NotGateway();
    error NotRole(Role expected);
    error NotVerified();
    error AlreadyRegistered();
    error NotRecordOwner();
    error RecordInactive();
    error InvalidDuration();
    error InvalidGrantee();
    error RequestNotPending();
    error EmergencyNotAllowed();
    error NoAccess();
    error InvalidIssuerKey();

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }
    modifier onlyGateway() { if (msg.sender != gateway) revert NotGateway(); _; }

    modifier onlyRole(Role r) {
        if (participants[msg.sender].role != r) revert NotRole(r);
        _;
    }

    modifier onlyVerified(Role r) {
        Participant storage p = participants[msg.sender];
        if (p.role != r) revert NotRole(r);
        if (!p.verified) revert NotVerified();
        _;
    }

    modifier onlyOwnerOf(uint256 recordId) {
        if (records[recordId].owner != msg.sender) revert NotRecordOwner();
        _;
    }

    constructor(address gateway_) {
        admin = msg.sender;
        gateway = gateway_;
        emit GatewayUpdated(gateway_);
    }

    // ------------------------------------------------------------------
    // Administration
    // ------------------------------------------------------------------
    function setGateway(address gateway_) external onlyAdmin {
        gateway = gateway_;
        emit GatewayUpdated(gateway_);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
    }

    /// @notice Register a hospital and its credential-issuing (Baby Jubjub) public key.
    function registerHospital(address hospital, string calldata name, uint256 issuerAx, uint256 issuerAy)
        external
        onlyAdmin
    {
        if (participants[hospital].role != Role.None) revert AlreadyRegistered();
        participants[hospital] = Participant({
            role: Role.Hospital,
            verified: true,
            name: name,
            encryptionPublicKey: "",
            hospital: address(0),
            registeredAt: uint64(block.timestamp)
        });
        emit ParticipantRegistered(hospital, Role.Hospital, name);
        _setIssuerKey(hospital, issuerAx, issuerAy);
    }

    function setIssuerKey(address hospital, uint256 issuerAx, uint256 issuerAy) external onlyAdmin {
        if (participants[hospital].role != Role.Hospital) revert NotRole(Role.Hospital);
        _setIssuerKey(hospital, issuerAx, issuerAy);
    }

    /// @notice Stop trusting credentials signed by this hospital's key (e.g. key compromise).
    function revokeIssuerKey(address hospital) external onlyAdmin {
        bytes32 k = hospitalIssuerKey[hospital];
        if (k != bytes32(0)) {
            delete issuerHospital[k];
            delete hospitalIssuerKey[hospital];
            emit IssuerKeyRevoked(hospital);
        }
    }

    function _setIssuerKey(address hospital, uint256 ax, uint256 ay) internal {
        if (ax == 0 && ay == 0) revert InvalidIssuerKey();
        bytes32 old = hospitalIssuerKey[hospital];
        if (old != bytes32(0)) delete issuerHospital[old];
        bytes32 k = keccak256(abi.encode(ax, ay));
        issuerHospital[k] = hospital;
        hospitalIssuerKey[hospital] = k;
        emit IssuerKeySet(hospital, ax, ay);
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------
    function registerPatient(string calldata name, string calldata encryptionPublicKey) external {
        if (participants[msg.sender].role != Role.None) revert AlreadyRegistered();
        participants[msg.sender] = Participant({
            role: Role.Patient,
            verified: true,
            name: name,
            encryptionPublicKey: encryptionPublicKey,
            hospital: address(0),
            registeredAt: uint64(block.timestamp)
        });
        emit ParticipantRegistered(msg.sender, Role.Patient, name);
    }

    /// @notice A doctor registers under a hospital; the hospital must verify them before they can request access.
    function registerDoctor(string calldata name, string calldata encryptionPublicKey, address hospital) external {
        if (participants[msg.sender].role != Role.None) revert AlreadyRegistered();
        if (participants[hospital].role != Role.Hospital) revert NotRole(Role.Hospital);
        participants[msg.sender] = Participant({
            role: Role.Doctor,
            verified: false,
            name: name,
            encryptionPublicKey: encryptionPublicKey,
            hospital: hospital,
            registeredAt: uint64(block.timestamp)
        });
        emit ParticipantRegistered(msg.sender, Role.Doctor, name);
    }

    function verifyDoctor(address doctor) external onlyVerified(Role.Hospital) {
        Participant storage d = participants[doctor];
        if (d.role != Role.Doctor || d.hospital != msg.sender) revert InvalidGrantee();
        d.verified = true;
        emit DoctorVerified(doctor, msg.sender);
    }

    function updateEncryptionKey(string calldata encryptionPublicKey) external {
        if (participants[msg.sender].role == Role.None) revert NotRole(Role.Patient);
        participants[msg.sender].encryptionPublicKey = encryptionPublicKey;
        emit EncryptionKeyUpdated(msg.sender);
    }

    // ------------------------------------------------------------------
    // Records
    // ------------------------------------------------------------------
    function addRecord(bytes32 contentHash, string calldata storageRef, string calldata category)
        external
        onlyRole(Role.Patient)
        returns (uint256 recordId)
    {
        recordId = ++recordCount;
        records[recordId] = Record({
            owner: msg.sender,
            contentHash: contentHash,
            storageRef: storageRef,
            category: category,
            createdAt: uint64(block.timestamp),
            active: true
        });
        _patientRecords[msg.sender].push(recordId);
        emit RecordAdded(recordId, msg.sender, contentHash, category);
    }

    function deactivateRecord(uint256 recordId) external onlyOwnerOf(recordId) {
        records[recordId].active = false;
        emit RecordDeactivated(recordId, msg.sender);
    }

    function getPatientRecords(address patient) external view returns (uint256[] memory) {
        return _patientRecords[patient];
    }

    // ------------------------------------------------------------------
    // Consent: requests and grants
    // ------------------------------------------------------------------
    function requestAccess(uint256 recordId, uint32 durationSeconds, string calldata purpose)
        external
        onlyVerified(Role.Doctor)
        returns (uint256 requestId)
    {
        Record storage r = records[recordId];
        if (!r.active) revert RecordInactive();
        if (durationSeconds == 0 || durationSeconds > MAX_GRANT_DURATION) revert InvalidDuration();

        requestId = ++requestCount;
        requests[requestId] = AccessRequest({
            recordId: recordId,
            requester: msg.sender,
            durationSeconds: durationSeconds,
            createdAt: uint64(block.timestamp),
            status: RequestStatus.Pending,
            purpose: purpose
        });
        emit AccessRequested(requestId, recordId, r.owner, msg.sender, durationSeconds, purpose);
    }

    /// @param durationSeconds 0 = use the duration the doctor asked for; otherwise the patient's own (shorter or longer) choice.
    function approveRequest(uint256 requestId, uint32 durationSeconds) external {
        AccessRequest storage q = requests[requestId];
        if (q.status != RequestStatus.Pending) revert RequestNotPending();
        if (records[q.recordId].owner != msg.sender) revert NotRecordOwner();
        uint32 d = durationSeconds == 0 ? q.durationSeconds : durationSeconds;
        q.status = RequestStatus.Approved;
        _grant(q.recordId, q.requester, d, false);
    }

    function rejectRequest(uint256 requestId) external {
        AccessRequest storage q = requests[requestId];
        if (q.status != RequestStatus.Pending) revert RequestNotPending();
        if (records[q.recordId].owner != msg.sender) revert NotRecordOwner();
        q.status = RequestStatus.Rejected;
        emit RequestRejected(requestId, q.recordId, msg.sender, q.requester);
    }

    function cancelRequest(uint256 requestId) external {
        AccessRequest storage q = requests[requestId];
        if (q.status != RequestStatus.Pending) revert RequestNotPending();
        if (q.requester != msg.sender) revert InvalidGrantee();
        q.status = RequestStatus.Cancelled;
        emit RequestCancelled(requestId, q.recordId, records[q.recordId].owner, msg.sender);
    }

    /// @notice Patient grants access directly, without a prior request.
    function grantAccess(uint256 recordId, address grantee, uint32 durationSeconds) external onlyOwnerOf(recordId) {
        Participant storage g = participants[grantee];
        if (!g.verified || (g.role != Role.Doctor && g.role != Role.Hospital)) revert InvalidGrantee();
        _grant(recordId, grantee, durationSeconds, false);
    }

    /// @notice Stops future access. It cannot retract data that was already viewed or downloaded.
    function revokeAccess(uint256 recordId, address grantee) external onlyOwnerOf(recordId) {
        delete grants[recordId][grantee];
        emit AccessRevoked(recordId, msg.sender, grantee);
    }

    function _grant(uint256 recordId, address grantee, uint32 durationSeconds, bool emergency) internal {
        Record storage r = records[recordId];
        if (!r.active) revert RecordInactive();
        if (durationSeconds == 0 || durationSeconds > MAX_GRANT_DURATION) revert InvalidDuration();
        uint64 exp = uint64(block.timestamp) + durationSeconds;
        grants[recordId][grantee] = Grant({ expiresAt: exp, emergency: emergency });
        emit AccessGranted(recordId, r.owner, grantee, exp, emergency);
    }

    // ------------------------------------------------------------------
    // Emergency (break-glass) access
    // ------------------------------------------------------------------
    /// @notice Patient pre-authorises a registered hospital for break-glass access to a record.
    function setEmergencyAccess(uint256 recordId, address hospital, bool allowed) external onlyOwnerOf(recordId) {
        if (participants[hospital].role != Role.Hospital) revert NotRole(Role.Hospital);
        emergencyAllowed[recordId][hospital] = allowed;
        emit EmergencyAccessConfigured(recordId, msg.sender, hospital, allowed);
    }

    /// @notice Hospital invokes break-glass access. Time-limited, audited, and visible to the patient.
    function breakGlass(uint256 recordId, string calldata reason) external onlyVerified(Role.Hospital) {
        if (!emergencyAllowed[recordId][msg.sender]) revert EmergencyNotAllowed();
        _grant(recordId, msg.sender, EMERGENCY_DURATION, true);
        emit EmergencyAccessUsed(recordId, records[recordId].owner, msg.sender, reason, uint64(block.timestamp) + EMERGENCY_DURATION);
    }

    // ------------------------------------------------------------------
    // Access checks and audit
    // ------------------------------------------------------------------
    function hasAccess(uint256 recordId, address account) public view returns (bool) {
        Record storage r = records[recordId];
        if (!r.active) return false;
        if (r.owner == account) return true;
        return grants[recordId][account].expiresAt > block.timestamp;
    }

    /// @notice Called by the backend gateway every time it releases an encrypted record to a non-owner.
    function logAccess(uint256 recordId, address accessor) external onlyGateway {
        if (!hasAccess(recordId, accessor)) revert NoAccess();
        accessCount[recordId] += 1;
        emit RecordAccessed(recordId, records[recordId].owner, accessor, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------
    // Views used by the ZK claim verifier and the frontend
    // ------------------------------------------------------------------
    function issuerFor(uint256 ax, uint256 ay) external view returns (address) {
        return issuerHospital[keccak256(abi.encode(ax, ay))];
    }

    function getParticipant(address account) external view returns (Participant memory) {
        return participants[account];
    }

    function getRecord(uint256 recordId) external view returns (Record memory) {
        return records[recordId];
    }

    function getRequest(uint256 requestId) external view returns (AccessRequest memory) {
        return requests[requestId];
    }
}

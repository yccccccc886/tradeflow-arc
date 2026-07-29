// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TradeFlowEscrow
/// @notice Native-USDC escrow for verified cross-border trade milestones on Arc.
contract TradeFlowEscrow {
    enum Status { None, Funded, InTransit, ReadyToRelease, Disputed, Settled, Refunded }

    struct Escrow {
        address buyer;
        address seller;
        address arbitrator;
        uint128 amount;
        uint64 inspectionDeadline;
        Status status;
    }

    uint16 public constant FEE_BPS = 35;
    uint16 private constant BPS = 10_000;
    address public immutable treasury;
    mapping(bytes32 => Escrow) public escrows;
    bool private locked;

    event EscrowOpened(bytes32 indexed reference, address indexed buyer, address indexed seller, uint256 amount, uint64 inspectionDeadline);
    event ShipmentMarked(bytes32 indexed reference);
    event DeliveryConfirmed(bytes32 indexed reference);
    event DisputeRaised(bytes32 indexed reference, address indexed raisedBy);
    event EscrowSettled(bytes32 indexed reference, address indexed seller, uint256 sellerAmount, uint256 fee);
    event EscrowRefunded(bytes32 indexed reference, address indexed buyer, uint256 amount);

    error InvalidParty();
    error InvalidState();
    error InvalidDeadline();
    error InvalidAmount();
    error ReferenceExists();
    error TransferFailed();
    error ReentrantCall();

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert InvalidParty();
        treasury = treasury_;
    }

    function openEscrow(
        address seller,
        address arbitrator,
        bytes32 reference,
        uint64 inspectionDeadline
    ) external payable {
        if (msg.value == 0 || msg.value > type(uint128).max) revert InvalidAmount();
        if (seller == address(0) || arbitrator == address(0) || seller == msg.sender) revert InvalidParty();
        if (inspectionDeadline <= block.timestamp) revert InvalidDeadline();
        if (escrows[reference].status != Status.None) revert ReferenceExists();

        escrows[reference] = Escrow({
            buyer: msg.sender,
            seller: seller,
            arbitrator: arbitrator,
            amount: uint128(msg.value),
            inspectionDeadline: inspectionDeadline,
            status: Status.Funded
        });
        emit EscrowOpened(reference, msg.sender, seller, msg.value, inspectionDeadline);
    }

    function markShipped(bytes32 reference) external {
        Escrow storage escrow = escrows[reference];
        if (msg.sender != escrow.seller) revert InvalidParty();
        if (escrow.status != Status.Funded) revert InvalidState();
        escrow.status = Status.InTransit;
        emit ShipmentMarked(reference);
    }

    function confirmDelivery(bytes32 reference) external {
        Escrow storage escrow = escrows[reference];
        if (msg.sender != escrow.buyer && msg.sender != escrow.arbitrator) revert InvalidParty();
        if (escrow.status != Status.InTransit) revert InvalidState();
        escrow.status = Status.ReadyToRelease;
        emit DeliveryConfirmed(reference);
    }

    function release(bytes32 reference) external nonReentrant {
        Escrow storage escrow = escrows[reference];
        if (msg.sender != escrow.buyer) revert InvalidParty();
        if (escrow.status != Status.ReadyToRelease) revert InvalidState();
        _settle(reference, escrow, true);
    }

    function raiseDispute(bytes32 reference) external {
        Escrow storage escrow = escrows[reference];
        if (msg.sender != escrow.buyer && msg.sender != escrow.seller) revert InvalidParty();
        if (escrow.status != Status.Funded && escrow.status != Status.InTransit && escrow.status != Status.ReadyToRelease) revert InvalidState();
        escrow.status = Status.Disputed;
        emit DisputeRaised(reference, msg.sender);
    }

    function resolve(bytes32 reference, bool releaseToSeller) external nonReentrant {
        Escrow storage escrow = escrows[reference];
        if (msg.sender != escrow.arbitrator) revert InvalidParty();
        if (escrow.status != Status.Disputed) revert InvalidState();
        _settle(reference, escrow, releaseToSeller);
    }

    function claimRefund(bytes32 reference) external nonReentrant {
        Escrow storage escrow = escrows[reference];
        if (msg.sender != escrow.buyer) revert InvalidParty();
        if (escrow.status != Status.Funded || block.timestamp <= escrow.inspectionDeadline) revert InvalidState();
        uint256 amount = escrow.amount;
        escrow.status = Status.Refunded;
        (bool ok, ) = escrow.buyer.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit EscrowRefunded(reference, escrow.buyer, amount);
    }

    function _settle(bytes32 reference, Escrow storage escrow, bool releaseToSeller) private {
        uint256 amount = escrow.amount;
        if (!releaseToSeller) {
            escrow.status = Status.Refunded;
            (bool refunded, ) = escrow.buyer.call{value: amount}("");
            if (!refunded) revert TransferFailed();
            emit EscrowRefunded(reference, escrow.buyer, amount);
            return;
        }

        uint256 fee = amount * FEE_BPS / BPS;
        uint256 sellerAmount = amount - fee;
        escrow.status = Status.Settled;
        (bool paid, ) = escrow.seller.call{value: sellerAmount}("");
        (bool feePaid, ) = treasury.call{value: fee}("");
        if (!paid || !feePaid) revert TransferFailed();
        emit EscrowSettled(reference, escrow.seller, sellerAmount, fee);
    }
}

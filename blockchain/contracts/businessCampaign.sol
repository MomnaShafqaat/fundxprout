// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IEquityToken {
    function mintEquity(address to, uint256 amount) external;
}

contract BusinessCampaign /*is Ownable*/ {

    enum CampaignState { Active , Failed , Funded}  //states should start with capital letters otherwise it gives error
    address public equityTokenAddress; //corresponding equity token for this campaign 

    mapping(address => uint256) public tokenEscrowBalances; //track how many token each investor is owed
    IEquityToken public equityToken;

    struct Campaign {
        address payable owner;         // The address that can withdraw funds if target is met
        //string variables will cost more gas 
        string name;                   // Name of the startup/campaign
        //string shortDescription;       // NEW: A brief summary of the campaign
        //string detailedPlan;           // NEW: Detailed targets and fund allocation plan
        uint256 fundingGoal;           // The minimum amount of wei needed to succeed
        uint256 deadline;              // Unix timestamp when the campaign ends
        uint256 amountRaised;          // Current total funds raised
        uint256  pricePerToken;         
        CampaignState state;           // Current status of the campaign
    }

    // The single campaign instance managed by this contract
    Campaign public startup;

    //to track user contribution in case of refund if campaign fails
    mapping(address => uint256) public contributions;

    //events

    event CampaignStarted(address indexed owner, uint256 fundingGoal, uint256 deadline);
    event Contribution(address indexed contributor, uint256 amount);
    event GoalReached(uint256 amountRaised);
    event CampaignEnded(CampaignState finalState);

        constructor(
        string memory _name, 
        //string memory _shortDescription, 
        //string memory _detailedPlan,
        uint256 _fundingGoal, 
        uint256 _deadlineTimestamp,
        uint256 _pricePerToken,
        address payable _owner //owner wallet address so withdraw can work and contract knows that owner is the one who can withdraw funds and msg.sender doesnt evaluate to the parent campaign factory contract 
    ) payable {
        // The address that deployed the contract is the campaign owner
        startup.owner = payable(_owner);
        startup.name = _name;
        //startup.shortDescription = _shortDescription; // NEW FIELD
        //startup.detailedPlan = _detailedPlan;         // NEW FIELD
        startup.fundingGoal = _fundingGoal;
        startup.deadline = _deadlineTimestamp;
        startup.state = CampaignState.Active;
        startup.amountRaised = 0;
        startup.pricePerToken = _pricePerToken;

        emit CampaignStarted(startup.owner, _fundingGoal, startup.deadline);
    }

    /** @dev Checks if the campaign is currently active (open for investment). */
    modifier onlyActive() {
        require(startup.state == CampaignState.Active, "Campaign is not Active");
        _;
    }

    /** @dev Checks if the deadline has passed. */
    modifier afterDeadline() {
        require(block.timestamp >= startup.deadline, "Deadline has not been reached yet.");
        _;
    }

        function contribute() public payable onlyActive {
        require(msg.value > 0, "Contribution must be greater than zero.");
            require(block.timestamp < startup.deadline, "Campaign deadline has passed.");

        // ── Insert Cap Check Here ──
        require(
            startup.amountRaised + msg.value <= startup.fundingGoal, 
            "Contribution exceeds the campaign funding goal."
        );
        
        uint256 tokensToBuy = (msg.value * 10**18) / startup.pricePerToken;
        
        // 1. Record the contribution amount for the investor
        contributions[msg.sender] += msg.value;

        // 2. Update the total amount raised
        startup.amountRaised += msg.value;

        // do not mint yet. Just record what they are owed in escrow.
        tokenEscrowBalances[msg.sender] += tokensToBuy;

        // 3. Check if the goal was just met
        if (startup.amountRaised >= startup.fundingGoal) {
            // Immediately transition to Funded state if the goal is met early
            startup.state = CampaignState.Funded;
            emit GoalReached(startup.amountRaised);
        }

        emit Contribution(msg.sender, msg.value);
    }

    /**
     * @dev Finalizes the campaign state and handles fund dispersal/refund.
     * This function should be called after the deadline has passed.
     */
    function finalize() public afterDeadline {
        
        // Cannot finalize if the goal was already reached early via contribution
        if (startup.state == CampaignState.Funded) {
             // The campaign is already funded and the owner can withdraw.
             // We ensure the funds are disbursed when the owner calls withdrawFunds.
             emit CampaignEnded(CampaignState.Funded);
             return;
        }

        // Check if the goal was met (in case it wasn't met via contribution but state wasn't updated)
        if (startup.amountRaised >= startup.fundingGoal) {
            startup.state = CampaignState.Funded;
            emit GoalReached(startup.amountRaised);
            emit CampaignEnded(CampaignState.Funded);
        } else {
            // Target not met, set to Failed state
            startup.state = CampaignState.Failed;
            emit CampaignEnded(CampaignState.Failed);
        }
    }

    /**
     * @dev Allows the owner to withdraw the raised funds if the campaign succeeded.
     * This uses a secure "Withdrawal Pattern" to send all funds to the owner.
     */
    function withdrawFunds() public {
        require(startup.state == CampaignState.Funded, "Campaign must be Funded to withdraw.");
        require(msg.sender == startup.owner, "Only the campaign owner can withdraw.");
        
        // Send the entire balance of the contract to the owner
        (bool success, ) = startup.owner.call{value: address(this).balance}("");
        require(success, "Withdrawal failed.");
    }

    /**
     * @dev Allows investors to request a refund if the campaign failed.
     * Note: This function allows investors to withdraw only their recorded contribution.
     */
    function refund() public {
        require(startup.state == CampaignState.Failed, "Refunds are only available if the campaign Failed.");
        
        uint256 amount = contributions[msg.sender];
        require(amount > 0, "No contribution recorded for this address.");
        
        // Set the contribution to zero BEFORE transferring the Ether (security measure)
        contributions[msg.sender] = 0; 

        // Send Ether back to the investor
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Refund transfer failed.");
    }

    function setTokenAddress(address _tokenAddress) external {
        // Security check: Only allow this to be set if it hasn't been linked to a token yet
        require(equityTokenAddress == address(0), "Token address has already been set.");
        equityTokenAddress = _tokenAddress;
        equityToken = IEquityToken(_tokenAddress); // initialize so mint token function doesnt fail
    }

    function claimTokens() public {
        // Enforce the escrow rule: Campaign must be successfully funded
        require(startup.state == CampaignState.Funded, "Campaign must be successful to claim tokens.");
        
        uint256 tokensOwed = tokenEscrowBalances[msg.sender];
        require(tokensOwed > 0, "No escrowed tokens available to claim.");

        // Clear the ledger balance BEFORE the external call (Reentrancy protection)
        tokenEscrowBalances[msg.sender] = 0;

        // Mint the tokens directly to their wallet now that the escrow conditions are met
        equityToken.mintEquity(msg.sender, tokensOwed);
    }

}
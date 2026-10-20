// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./businessCampaign.sol";
import "./equityToken.sol";

contract CampaignFactory {
    BusinessCampaign[] public deployedCampaigns;

    // ✅ Add this event
    event CampaignCreated(address campaignAddress, address tokenAddress, address owner);

    function createCampaign(
        string memory _name,
        string memory _symbol,
        uint256 _fundingGoal,
        uint256 _deadlineTimestamp,
        uint256 _pricePerToken
        ) public {

        BusinessCampaign newCampaign = new BusinessCampaign(
            _name,
            _fundingGoal,
            _deadlineTimestamp,
            _pricePerToken,
            payable(msg.sender) //the owner calling this function is the owner and not this contract which is interpreted in business cmapaign if this isnt passed
        );

        //deploy the business equity token contract 
        EquityToken newToken = new EquityToken(
            _name,
            _symbol,
            address(newCampaign)
        );

        newCampaign.setTokenAddress(address(newToken));

        deployedCampaigns.push(newCampaign);

        // ✅ Emit so the frontend can read the deployed address (hafsa)
        emit CampaignCreated(address(newCampaign), address(newToken), msg.sender);
    }
}
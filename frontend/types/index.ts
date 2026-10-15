export interface Token {
  id: string;
  name: string;
  symbol: string;
  contractAddress: string;
  balance: number;
  amount: number;
  price: number;
  value: number;
  equity_percent: number;
  change24h: number;
  priceHistory: number[];
  campaignId: string;
  color: string;
  priceEth: number;
  pricePerToken: number;
  postmoneyValuation: number;
}

export interface Campaign {
  id: string;
  name: string;
  title: string;
  imageUrl: string;
  description: string;
  industry: 'Energy' | 'Real Estate' | 'Healthcare' | 'Agriculture' | 'Finance' | 'Infrastructure';
  category: string;
  investedAmount: number;
  tokenAmount: number;
  tokenSymbol: string;
  fundedPercent: number;
  amount_pledged: number;
  funding_goal: number;
  totalTarget: number;
  roi: number;
  status: 'Active' | 'Completed' | 'Pending';
  startDate: string;
  endDate?: string;
}

export interface Transaction {
  id: string;
  hash: string;
  type: 'Buy' | 'Transfer' | 'Stake' | 'Dividend' | 'Sell';
  tokenSymbol: string;
  tokenAmount: number;
  valueUSD: number;
  date: string;
  status: 'Confirmed' | 'Pending' | 'Failed';
  from?: string;
  to?: string;
}

export interface InvestorProfile {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  tier: 'Retail' | 'Accredited' | 'Institutional';
  kycStatus: 'Verified' | 'Pending' | 'Not Started';
  joinDate: string;
  totalInvested: number;
  totalReturns: number;
  portfolioValue: number;
}

export interface PortfolioDataPoint {
  month: string;
  value: number;
}

export interface Investment{
  campaign: Campaign;
  amount : number;
  date: string;
  status: 'active' | 'completed' | 'pending' | 'claimed' | 'failed' | 'refunded';
}

import { Token } from '@/types';

export function calculateUserEquity(token: Token): number {
  const postMoney = parseFloat(String(token.postmoneyValuation ?? 0));

  // 1. Calculate investor's total ETH contribution for this token
  const tokenPriceEth = parseFloat(String(( token.pricePerToken) || 0));
  const balance = parseFloat(String(token.balance ?? 0));
  const userInvestedEth = parseFloat(String(tokenPriceEth));
  // If postMoney is available:
  if (postMoney > 0 && userInvestedEth > 0) {
    return Number(((tokenPriceEth / postMoney) * 100).toFixed(4));
  }

  return 0;
}
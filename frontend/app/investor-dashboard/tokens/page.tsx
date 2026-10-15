// ── frontend/app/investor-dashboard/tokens/page.tsx ───────────────────────────────────────────────
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Send, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrency, formatNumber, formatPercent, truncateAddress } from '@/lib/formatters';
import { getUserTokenHoldings } from '@/utils/supabase/getPortfolio';
import { Token } from '@/types';
import { calculateUserEquity } from '@/lib/equity/tokenEquity';

// ── Badge helper ─────────────────────────────────────────────────────
function Badge({
  children,
  variant = 'purple',
}: {
  children: React.ReactNode;
  variant?: 'green' | 'red' | 'purple';
}) {
  const cls: Record<string, string> = {
    green:  'bg-green-500/10 text-green-400 border-green-500/20',
    red:    'bg-destructive/10 text-destructive border-destructive/20',
    purple: 'bg-[#6f42c1]/15 text-[#a78bfa] border-[#6f42c1]/25',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls[variant]}`}>
      {children}
    </span>
  );
}

export default function TokensPage() {
  const [tokenHoldings, setTokenHoldings] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTokens() {
      try {
        const holdings = await getUserTokenHoldings();
        setTokenHoldings(holdings);
      } finally {
        setLoading(false);
      }
    }
    loadTokens();
  }, []);

  if (loading) {
    return <div className="text-center text-muted-foreground pt-10">Loading tokens...</div>;
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Network status bar ── */}
      <div className="bg-card border border-border rounded-2xl px-6 py-4 flex items-center gap-6">
        <div className="flex items-center gap-2.5 text-[13px]">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: 'var(--chart-3)', boxShadow: '0 0 6px var(--chart-3)' }}
          />
          <span className="text-muted-foreground font-medium">Ethereum Mainnet</span>
        </div>  
        <div className="ml-auto">
          <button className="bg-[#6f42c1] hover:bg-[#5a3599] text-white text-xs font-semibold px-[18px] py-2 rounded-xl transition-all">
            + Import Token
          </button>
        </div>
      </div>

      {/* ── Token Cards ── */}
      {tokenHoldings.length > 0 ? (
        <div className="grid grid-cols-2 gap-5">
          {tokenHoldings.map((token) => (
            <div
              key={token.id}
              className="bg-card border border-border rounded-2xl p-7 hover:border-ring/40 transition-all duration-200"
            >
              {/* Token header */}
              <div className="flex items-center gap-3.5 mb-5">
                <div
                  className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${token.color}, rgba(0,0,0,0.4))`,
                    boxShadow:  `0 0 24px ${token.color}33`,
                  }}
                >
                  {token.symbol.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-bold text-foreground">{token.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
                    {truncateAddress(token.contractAddress || '0x...', 8, 5)}
                  </div>
                </div>
                <Badge variant={token.change24h >= 0 ? 'green' : 'red'}>
                  {token.change24h >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                  {formatPercent(token.change24h)}
                </Badge>
              </div>

              {/* Balance + value */}
              <div className="grid grid-cols-3 gap-3.5 mb-5">
                <div className="px-[18px] py-4 bg-muted border border-border rounded-xl">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-[0.08em] mb-1.5 font-bold">Balance</div>
                  <div className="text-[22px] font-black text-foreground tracking-tight">{formatNumber(token.balance)}</div>
                  <div className="text-xs text-muted-foreground">{token.symbol} tokens</div>
                </div>
                <div className="px-[18px] py-4 bg-muted border border-border rounded-xl">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-[0.08em] mb-1.5 font-bold">Equity Held</div>
                  <div className="text-[22px] font-black text-foreground tracking-tight">{calculateUserEquity(token)}%</div>
                  <div className="text-xs text-muted-foreground">Post Money Valuation: {formatCurrency(token.postmoneyValuation, 2)} ETH</div>
                </div>
                <div className="px-[18px] py-4 bg-muted border border-border rounded-xl">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-[0.08em] mb-1.5 font-bold">Price</div>
                  <div className="text-[22px] font-black text-foreground tracking-tight">
                    {formatCurrency(token.pricePerToken, 2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ≈ {(token.value / (token.pricePerToken)).toFixed(4)} ETH
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    @ {formatCurrency(token.price, 2)} ({(token.priceEth ?? 0).toFixed(6)} ETH)/token
                  </div>
                </div>
              </div>

              {/* Sparkline */}
              <div className="mb-5">
                <div className="text-[11px] text-muted-foreground mb-2 font-semibold">Price History (Real Trade Analytics)</div>
                <ResponsiveContainer width="100%" height={56}>
                  <LineChart data={(token.priceHistory || []).map((item: any, idx: number) => typeof item === 'object' ? { v: Number(item.price.toFixed(4)), time: item.time } : { v: item, time: `P${idx+1}` })}>
                    <Tooltip
                      formatter={(v: any) => [`$${v}`, 'Price']}
                      labelFormatter={(label: any, payload: any) => payload?.[0]?.payload?.time || label}
                      contentStyle={{
                        background:   'var(--card)',
                        border:       '1px solid var(--border)',
                        borderRadius: 12,
                        fontSize:     11,
                        color:        'var(--foreground)',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="v"
                      stroke={token.change24h >= 0 ? 'var(--chart-3)' : 'var(--destructive)'}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: token.change24h >= 0 ? 'var(--chart-3)' : 'var(--destructive)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5">
                <button className="flex-1 justify-center bg-[#6f42c1] hover:bg-[#5a3599] text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all inline-flex items-center gap-2">
                  <Send size={14} /> Transfer
                </button>
                <Link
                  href={`/investor-dashboard/marketplace/${token.campaignId}?side=sell`}
                  className="flex-1 justify-center bg-[#6f42c1] hover:bg-[#5a3599] text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all inline-flex items-center gap-2"
                >
                  <ArrowUpRight size={14} /> Sell
                </Link>
                <button className="text-muted-foreground hover:text-foreground px-3 py-2.5 rounded-xl border border-border hover:bg-muted transition-all">
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl text-center px-16 py-16 text-muted-foreground">
          No tokens yet. Invest in campaigns to receive equity tokens.
        </div>
      )}

    </div>
  );
}
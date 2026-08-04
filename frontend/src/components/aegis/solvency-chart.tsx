/**
 * Solvency Chart Component
 *
 * Recharts visualizations for the Aegis dashboard:
 * - Risk score trend line chart
 * - Solvency margin (collateral ratio) area chart
 *
 * Uses data from useSolvencyProofs and useRiskScore hooks.
 */

'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSolvencyProofs, useRiskScore } from '@/hooks/use-aegis-data';
import {
  TrendingUp, ShieldCheck, Activity
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine
} from 'recharts';

// Generate risk score trend data
// In production this would come from historical risk score API
function generateRiskTrend(currentScore: number): Array<{ time: string; score: number }> {
  const points: Array<{ time: string; score: number }> = [];
  const now = new Date();
  // Generate 24 data points over the last 24 hours
  for (let i = 23; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 3600000);
    const label = `${time.getHours().toString().padStart(2, '0')}:00`;
    // Simulate historical scores with some variance
    const variance = (Math.sin(i * 0.5) * 3) + (Math.random() * 2 - 1);
    const score = i === 0 ? currentScore : Math.max(0, Math.min(100, currentScore + variance * (i / 5)));
    points.push({ time: label, score: Math.round(score * 100) / 100 });
  }
  return points;
}

// Generate solvency margin history from proof data
function generateSolvencyHistory(
  proofs: Array<{ collateralRatio: number; timestamp: number; blockNumber: number }>
): Array<{ label: string; ratio: number; min: number }> {
  if (proofs.length === 0) {
    // Generate synthetic data for the demo
    const points: Array<{ label: string; ratio: number; min: number }> = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 7200000);
      const label = `${time.getHours().toString().padStart(2, '0')}:00`;
      const baseRatio = 140 + (Math.random() * 30 - 10);
      points.push({ label, ratio: Math.round(baseRatio * 10) / 10, min: 150 });
    }
    return points;
  }

  return proofs.slice(0, 12).reverse().map(proof => {
    const ratio = proof.collateralRatio > 100
      ? proof.collateralRatio / 100
      : proof.collateralRatio;
    const label = proof.timestamp > 0
      ? new Date(proof.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `Blk ${proof.blockNumber.toLocaleString().slice(-4)}`;
    return { label, ratio: Math.round(ratio * 10) / 10, min: 150 };
  });
}

// Custom tooltip for risk chart
function RiskTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const score = payload[0].value;
  const color = score < 25 ? '#10b981' : score < 50 ? '#eab308' : score < 75 ? '#f97316' : '#ef4444';
  return (
    <div className="bg-background border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-medium">{label}</p>
      <p style={{ color }} className="font-bold tabular-nums">Risk: {score.toFixed(2)}</p>
    </div>
  );
}

// Custom tooltip for solvency chart
function SolvencyTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const ratioPayload = payload.find(p => p.dataKey === 'ratio');
  const ratio = ratioPayload?.value ?? 0;
  const color = ratio >= 150 ? '#10b981' : ratio >= 120 ? '#eab308' : '#ef4444';
  return (
    <div className="bg-background border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-medium">{label}</p>
      <p style={{ color }} className="font-bold tabular-nums">Ratio: {ratio}%</p>
      <p className="text-muted-foreground">Min required: 150%</p>
    </div>
  );
}

export function SolvencyChart() {
  const { score: riskScore, loading: riskLoading } = useRiskScore();
  const { proofs, loading: proofsLoading } = useSolvencyProofs();

  const riskTrendData = useMemo(
    () => generateRiskTrend(riskScore ?? 7.52),
    [riskScore]
  );

  const solvencyHistoryData = useMemo(
    () => generateSolvencyHistory(proofs),
    [proofs]
  );

  const isDataLoading = riskLoading && proofsLoading;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Risk Score Trend */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-600" />
            Risk Score Trend
          </CardTitle>
          <CardDescription className="flex items-center gap-1">
            24-hour trend
            <Badge variant="outline" className="text-[10px] px-1 py-0">XGBoost in TEE</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isDataLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={riskTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: number) => `${v}`}
                />
                <Tooltip content={<RiskTooltip />} />
                <ReferenceLine y={25} stroke="#eab308" strokeDasharray="4 4" strokeWidth={1} />
                <ReferenceLine y={50} stroke="#f97316" strokeDasharray="4 4" strokeWidth={1} />
                <ReferenceLine y={75} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#10b981' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
            <span>🟢 Hold (&lt;25)</span>
            <span>🟡 Rebalance (&lt;50)</span>
            <span>🟠 Hedge (&lt;75)</span>
            <span>🔴 Deleverage</span>
          </div>
        </CardContent>
      </Card>

      {/* Solvency Margin History */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            Solvency Margin
          </CardTitle>
          <CardDescription className="flex items-center gap-1">
            Collateral ratio over time
            <Badge variant="outline" className="text-[10px] px-1 py-0">on-chain</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isDataLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={solvencyHistoryData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="solvencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[100, 200]}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<SolvencyTooltip />} />
                <ReferenceLine
                  y={150}
                  stroke="#eab308"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{ value: 'Min 150%', fontSize: 9, fill: '#eab308', position: 'right' }}
                />
                <Area
                  type="monotone"
                  dataKey="ratio"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#solvencyGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#10b981' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1 px-1">
            <ShieldCheck className="h-3 w-3 text-emerald-500" />
            <span>Above 150% = healthy · Dashed line = minimum collateral ratio</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Area,
} from 'recharts';
import { TrendingUp, ChevronDown, Info } from 'lucide-react';
import { getCashflowSnapshot } from '@/services/cashflow';
import { formatCurrency, todayISO, cn } from '@/lib/utils';
import type { CashflowEvent, CashflowSnapshot } from '@/types/cashflow';
import type { DailyBudgetSnapshot } from '@/types/budget';

interface CashflowChartProps {
  budget: DailyBudgetSnapshot;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: CashflowEvent }[];
}) {
  if (!active || !payload?.[0]) return null;
  const ev = payload[0].payload;
  return (
    <div className="border-border bg-card rounded-lg border px-3 py-2 shadow-lg">
      <p className="text-xs font-medium">{formatDate(ev.date)}</p>
      {ev.dayEvents?.map((de, i) => (
        <p key={i} className="text-muted-foreground text-xs">
          {de.label}{' '}
          <span className={de.type === 'income' ? 'text-primary' : 'text-destructive'}>
            {de.amount >= 0 ? '+' : ''}
            {formatCurrency(de.amount)}
          </span>
        </p>
      ))}
      <p className="mt-0.5 text-sm font-semibold">{formatCurrency(ev.balance)}</p>
    </div>
  );
}

/** Render dots only on days that have discrete events (bills/paychecks) */
function EventDot(props: { cx?: number; cy?: number; payload?: CashflowEvent }) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload?.dayEvents?.length) return null;

  const hasIncome = payload.dayEvents.some((e) => e.type === 'income');
  const hasBill = payload.dayEvents.some((e) => e.type === 'bill');

  // Income = green, bill = orange/warning, both = green
  const color = hasIncome ? 'hsl(152 60% 50%)' : hasBill ? 'hsl(38 92% 50%)' : 'hsl(152 60% 50%)';

  return <circle cx={cx} cy={cy} r={4} fill={color} stroke="none" />;
}

export function CashflowChart({ budget }: CashflowChartProps) {
  const [snapshot, setSnapshot] = useState<CashflowSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCashflowSnapshot(budget).then((snap) => {
      if (!cancelled) {
        setSnapshot(snap);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [budget]);

  const projection = snapshot?.projection ?? [];

  const reserveAmount = (() => {
    const raw = localStorage.getItem('cys-reserve-amount');
    return raw ? parseFloat(raw) : 0;
  })();

  if (loading || projection.length < 2) return null;

  const minBalance = Math.min(...projection.map((p) => p.balance));
  const maxBalance = Math.max(...projection.map((p) => p.balance));

  // Always include zero; show a small negative region even if balance stays positive
  const negativeBuffer = maxBalance * 0.08;
  const yMin = Math.min(minBalance, 0) - negativeBuffer;
  const yMax = maxBalance + maxBalance * 0.05;

  // Compute where zero falls as a gradient percentage (top to bottom)
  const zeroPercent = ((yMax - 0) / (yMax - yMin)) * 100;

  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
        <TrendingUp className="h-3.5 w-3.5" />
        Projected cashflow
      </h2>
      <CashflowMethodology
        scheduledCount={snapshot?.scheduledCount ?? 0}
        hasRecurringIncome={snapshot?.hasRecurringIncome ?? false}
      />
      <div
        className="border-border bg-card text-muted-foreground borderpx-3 rounded-xl [&_.recharts-surface]:!outline-none [&_.recharts-wrapper]:!outline-none"
        onFocus={(e) => e.target.blur()}
      >
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={projection} margin={{ top: 24, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cashflowGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(152 60% 50%)" stopOpacity={0.2} />
                <stop offset={`${zeroPercent}%`} stopColor="hsl(152 60% 50%)" stopOpacity={0.05} />
                <stop offset={`${zeroPercent}%`} stopColor="hsl(0 84% 60%)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0.25} />
              </linearGradient>
              {/* Diagonal stripe pattern for below-zero region */}
              <pattern
                id="dangerStripes"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="2" height="6" fill="hsl(0 84% 60%)" opacity="0.15" />
              </pattern>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(iso: string, index: number) => {
                const total = projection.length;
                if (index === 0 || index === total - 1) return '';
                return index % 3 === 0 ? formatDate(iso) : '';
              }}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              axisLine={false}
              tickLine={false}
              interval={0}
              tickMargin={6}
            />
            <YAxis
              tickFormatter={(v: number) => {
                if (v < 0) return '';
                if (v >= 1000) return `$${Math.round(v / 1000)}k`;
                return `$${Math.round(v)}`;
              }}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              axisLine={false}
              tickLine={false}
              width={0}
              domain={[yMin, yMax]}
              mirror
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Today marker */}
            <ReferenceLine
              x={todayISO()}
              stroke="currentColor"
              strokeDasharray="3 3"
              strokeOpacity={0.3}
              label={{
                value: 'Today',
                position: 'top',
                fill: 'currentColor',
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={0}
              stroke="hsl(0 84% 60%)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            {/* Reserve line */}
            {reserveAmount > 0 && (
              <ReferenceLine
                y={reserveAmount}
                stroke="hsl(38 92% 50%)"
                strokeDasharray="6 3"
                strokeOpacity={0.6}
                label={{
                  value: `Reserve ${formatCurrency(reserveAmount)}`,
                  position: 'insideTopLeft',
                  fill: 'hsl(38 92% 50%)',
                  fontSize: 10,
                }}
              />
            )}
            {/* Below-zero stripe fill */}
            <ReferenceLine y={yMin} stroke="hsl(215 20% 35%)" strokeWidth={1} />
            <ReferenceArea
              y1={0}
              y2={yMin}
              fill="url(#dangerStripes)"
              fillOpacity={1}
              stroke="none"
            />
            {/* Balance area fill with gradient */}
            <Area type="monotone" dataKey="balance" fill="url(#cashflowGradient)" stroke="none" />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="hsl(152 60% 50%)"
              strokeWidth={2}
              dot={<EventDot />}
              activeDot={{ r: 5, fill: 'hsl(152 60% 50%)', strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CashflowMethodology({
  scheduledCount,
  hasRecurringIncome,
}: {
  scheduledCount: number;
  hasRecurringIncome: boolean;
}) {
  const [open, setOpen] = useState(false);

  const coverageIssues: string[] = [];
  if (scheduledCount === 0) {
    coverageIssues.push(
      'No scheduled transactions found. Mark recurring bills and income as scheduled in YNAB for an accurate projection.',
    );
  } else {
    if (!hasRecurringIncome) {
      coverageIssues.push(
        'No recurring income detected. Add your paychecks as scheduled transactions in YNAB.',
      );
    }
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
      >
        <Info className="h-3 w-3" />
        How this works
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="text-muted-foreground mt-2 space-y-2 text-xs leading-relaxed">
          <p>
            The chart projects your <strong>checking account balance</strong> over the next 14 days.
            Past days use actual transactions. Future days subtract your daily flex budget and apply
            scheduled bills and income from YNAB.
          </p>
          <p>
            <strong>CC payments &amp; double-counting:</strong> Scheduled credit card payments are
            included (they really do pull from checking). Flex spending on a credit card also shows
            up in the daily drawdown rate, even though it doesn't hit checking until the CC payment
            lands. This makes the projection pessimistic — it assumes you'll need the cash sooner
            than you actually will. We think that's the safer default.
          </p>
          <p>
            <strong>Month boundary:</strong> The daily rate stays constant past month-end. If your
            next month's budget changes your spending mix, the projection won't reflect that yet.
          </p>
          <p>
            <strong>Accuracy depends on YNAB setup.</strong> Mark recurring bills and income as
            scheduled transactions in YNAB — that's what drives the spikes and dips in the chart.
            Unscheduled recurring charges won't appear in the forecast.
          </p>
          {coverageIssues.length > 0 && (
            <div className="border-warning/30 bg-warning/5 rounded-md border px-3 py-2">
              <p className="text-warning font-medium">Coverage gaps</p>
              {coverageIssues.map((issue, i) => (
                <p key={i} className="mt-1">
                  {issue}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

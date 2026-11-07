import { Link } from "react-router-dom";
import {
  Award,
  CreditCard,
  Layers,
  Repeat,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { formatVenueDateTime, Money } from "../../components/format";
import { Badge, Card, Skeleton, type Tone } from "../../components/ui";
import {
  formatCount,
  formatHours,
  formatPercent,
  safeNumber,
  type StatsPlayersResponse,
} from "./dashboardStatsApi";
import { InlineChartEmpty } from "./statsCharts";

function paymentTone(status: string): Tone {
  if (status === "succeeded") return "success";
  if (status === "partially_refunded" || status === "pending") return "warning";
  if (status === "refunded" || status === "failed" || status === "cancelled") return "danger";
  return "neutral";
}

export function DashboardPlayersSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading player and channel insights"
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5 xl:col-span-7">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3.5 w-64" />
          <Skeleton className="mt-5 h-64 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5 xl:col-span-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3.5 w-64" />
          <Skeleton className="mt-5 h-64 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function DashboardPlayersSection({
  players,
  currency,
  timeZone,
  dateRangeLabel,
}: {
  players: StatsPlayersResponse;
  currency: string;
  timeZone: string;
  dateRangeLabel: string;
}) {
  const {
    hasData,
    retention,
    topPlayers,
    paymentBreakdown,
    channelBreakdown,
  } = players;

  const returningShare = Math.min(
    100,
    Math.max(0, safeNumber(retention.returningSharePercent)),
  );
  const newShare = Math.min(100, Math.max(0, safeNumber(retention.newSharePercent)));

  return (
    <section aria-label="Player and channel insights" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 reveal-left">
        <div>
          <h2 className="font-display text-lg font-semibold text-fg sm:text-xl">
            Player Loyalty, Channel & Payment Insights
          </h2>
          <p className="text-xs text-fg-muted sm:text-sm">
            Top players leaderboard, new vs returning retention, booking channels, and payment status for{" "}
            {dateRangeLabel}.
          </p>
        </div>
        <Link
          to="/dashboard/recommendations"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text hover:underline"
        >
          <Award className="h-3.5 w-3.5" aria-hidden="true" />
          Player Comeback Rewards →
        </Link>
      </div>

      {/* Row 1: Top Players Leaderboard (7 cols) + Retention & Channels (5 cols) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Card A: Top Players Leaderboard */}
        <Card
          className="xl:col-span-7 reveal-up"
          title="Top Players Leaderboard"
          description="Ranked by confirmed bookings and total spend in the selected period."
          actions={
            <Badge tone="accent" icon={<Trophy className="h-3 w-3" aria-hidden="true" />}>
              Top {topPlayers.length || 10}
            </Badge>
          }
        >
          {!hasData || topPlayers.length === 0 ? (
            <InlineChartEmpty
              icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
              title={`No player leaderboard data for ${dateRangeLabel}`}
              description="Players who book court sessions or drop-in socials during this period will appear here ranked by activity and spend."
            />
          ) : (
            <>
              {/* Desktop / Tablet Table (md+) */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                      <th className="pb-2.5 pr-2">Rank</th>
                      <th className="pb-2.5 px-2">Player</th>
                      <th className="pb-2.5 px-2">Status</th>
                      <th className="pb-2.5 px-2 text-right">Bookings</th>
                      <th className="pb-2.5 px-2 text-right">Total Spend</th>
                      <th className="pb-2.5 pl-2 text-right">Last Booking</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {topPlayers.map((player) => (
                      <tr key={player.userId} className="hover:bg-inset/50">
                        <td className="py-2.5 pr-2 font-display font-semibold tabular-nums text-fg">
                          <span
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                              player.rank <= 3
                                ? "bg-accent text-accent-fg font-bold"
                                : "bg-inset text-fg-muted"
                            }`}
                          >
                            {player.rank}
                          </span>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-accent/15 font-display text-xs font-semibold text-accent-text"
                              aria-hidden="true"
                            >
                              {player.initials}
                            </span>
                            <div className="min-w-0">
                              <Link
                                to={`/dashboard/users/${player.userId}`}
                                className="block truncate font-semibold text-fg hover:text-accent-text hover:underline"
                              >
                                {player.displayName}
                              </Link>
                              <span className="block truncate text-[11px] text-fg-muted">
                                {player.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge tone={player.isReturning ? "accent" : "info"}>
                            {player.isReturning ? "Returning" : "New"}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums">
                          <span className="font-semibold text-fg">
                            {formatCount(player.bookingsCount)}
                          </span>
                          <span className="block text-[11px] text-fg-muted">
                            {formatCount(player.courtBookingsCount)}c ·{" "}
                            {formatCount(player.socialBookingsCount)}s ·{" "}
                            {formatHours(player.bookedHours)}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right font-semibold tabular-nums text-fg">
                          <Money amount={safeNumber(player.totalSpend)} currency={currency} />
                        </td>
                        <td className="py-2.5 pl-2 text-right text-[11px] text-fg-muted">
                          {formatVenueDateTime(player.lastBookingAt, timeZone)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Compact Cards (<md) */}
              <ul className="space-y-2.5 md:hidden">
                {topPlayers.map((player) => (
                  <li
                    key={player.userId}
                    className="rounded-xl border border-border bg-inset/50 p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${
                            player.rank <= 3
                              ? "bg-accent text-accent-fg font-bold"
                              : "bg-surface-2 text-fg-muted font-semibold"
                          }`}
                        >
                          #{player.rank}
                        </span>
                        <span
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-accent/15 font-display text-xs font-semibold text-accent-text"
                          aria-hidden="true"
                        >
                          {player.initials}
                        </span>
                        <div className="min-w-0">
                          <Link
                            to={`/dashboard/users/${player.userId}`}
                            className="block truncate font-semibold text-fg hover:text-accent-text hover:underline"
                          >
                            {player.displayName}
                          </Link>
                          <p className="truncate text-[11px] text-fg-muted">{player.email}</p>
                        </div>
                      </div>
                      <Badge tone={player.isReturning ? "accent" : "info"}>
                        {player.isReturning ? "Returning" : "New"}
                      </Badge>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 tabular-nums text-fg-muted">
                      <span>
                        <strong className="font-semibold text-fg">
                          {formatCount(player.bookingsCount)}
                        </strong>{" "}
                        bookings ({formatHours(player.bookedHours)})
                      </span>
                      <span className="font-semibold text-fg">
                        <Money amount={safeNumber(player.totalSpend)} currency={currency} />
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-fg-muted">
                      Last booking: {formatVenueDateTime(player.lastBookingAt, timeZone)}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Card B: Player Retention & Booking Channels */}
        <div className="space-y-4 xl:col-span-5 reveal-stagger">
          {/* Player Retention Card */}
          <Card
            title="Player Retention (New vs Returning)"
            description="Customer loyalty and repeat series adoption at this venue."
            actions={
              <Badge tone="neutral" icon={<Users className="h-3 w-3" aria-hidden="true" />}>
                {formatCount(retention.totalUniquePlayers)} players
              </Badge>
            }
          >
            {retention.totalUniquePlayers === 0 ? (
              <InlineChartEmpty
                icon={<Users className="h-5 w-5" aria-hidden="true" />}
                title="No active players in this period"
                description="New vs returning player retention metrics will appear once bookings are confirmed."
              />
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex h-3 w-full overflow-hidden rounded-full bg-inset">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${returningShare}%` }}
                      title={`Returning: ${retention.returningPlayers}`}
                    />
                    <div
                      className="h-full bg-accent/40 transition-all duration-300"
                      style={{ width: `${newShare}%` }}
                      title={`New: ${retention.newPlayers}`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div className="rounded-xl border border-border bg-inset/60 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <UserCheck className="h-3.5 w-3.5 text-accent-text" aria-hidden="true" />
                        <span>Returning Players</span>
                      </div>
                      <p className="mt-1 font-display text-xl font-semibold tabular-nums text-fg">
                        {formatCount(retention.returningPlayers)}{" "}
                        <span className="text-xs font-normal text-fg-muted">
                          ({formatPercent(returningShare, 1)})
                        </span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-inset/60 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <UserPlus className="h-3.5 w-3.5 text-accent-text" aria-hidden="true" />
                        <span>New Players</span>
                      </div>
                      <p className="mt-1 font-display text-xl font-semibold tabular-nums text-fg">
                        {formatCount(retention.newPlayers)}{" "}
                        <span className="text-xs font-normal text-fg-muted">
                          ({formatPercent(newShare, 1)})
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-inset/40 px-3.5 py-2.5 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Repeat className="h-3.5 w-3.5 text-accent-text" aria-hidden="true" />
                    Weekly Series / Group Bookings:
                  </span>
                  <span className="font-semibold tabular-nums text-fg">
                    {formatCount(retention.seriesBookings)} slots ({formatCount(retention.repeatHoldBookings)} auto-repeat)
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Booking Channel Breakdown Card */}
          <Card
            title="Bookings by Channel & Type"
            description="Volume and revenue split across court booking types and drop-in socials."
            actions={
              <Badge tone="neutral" icon={<Layers className="h-3 w-3" aria-hidden="true" />}>
                Channels
              </Badge>
            }
          >
            <div className="space-y-3">
              {channelBreakdown.map((ch) => {
                const share = Math.min(100, Math.max(0, safeNumber(ch.sharePercent)));
                return (
                  <div key={ch.channel} className="space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-fg">{ch.label}</span>
                      <span className="tabular-nums text-fg-muted">
                        <strong className="font-semibold text-fg">
                          {formatCount(ch.bookingsCount)}
                        </strong>{" "}
                        ({formatPercent(share, 1)}) ·{" "}
                        <strong className="font-semibold text-fg">
                          <Money amount={safeNumber(ch.revenue)} currency={currency} />
                        </strong>
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-inset">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-300"
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* Row 2: Revenue by Payment Status (Optional Section F) */}
      <Card
        className="reveal-up"
        title="Revenue by Payment Status"
        description="Card payments, refunds, and net settled revenue for bookings in this period."
        actions={
          <Link
            to="/dashboard/payments"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text hover:underline"
          >
            <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
            Open Payments Desk →
          </Link>
        }
      >
        {paymentBreakdown.length === 0 ? (
          <InlineChartEmpty
            icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
            title={`No card payment records for ${dateRangeLabel}`}
            description="Payments and refunds linked to court or social bookings in this period will be summarized here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {paymentBreakdown.map((item) => (
              <div
                key={item.status}
                className="flex flex-col justify-between rounded-xl border border-border bg-inset/50 p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={paymentTone(item.status)}>{item.label}</Badge>
                  <span className="text-xs font-medium tabular-nums text-fg-muted">
                    {formatCount(item.count)} {item.count === 1 ? "tx" : "txs"} (
                    {formatPercent(item.sharePercent, 1)})
                  </span>
                </div>
                <div className="mt-3">
                  <p className="font-display text-xl font-semibold tabular-nums text-fg">
                    <Money amount={safeNumber(item.netAmount)} currency={currency} />
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-fg-muted">
                    Gross: <Money amount={safeNumber(item.grossAmount)} currency={currency} />
                    {item.refundedAmount > 0 ? (
                      <>
                        {" "}
                        · Refunded:{" "}
                        <Money amount={safeNumber(item.refundedAmount)} currency={currency} />
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}


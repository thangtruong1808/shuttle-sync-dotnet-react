import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Money } from "../../components/format";
import { Button, buttonClass } from "../../components/ui";
import { rememberCourtPromo, rememberPointShare } from "../venues/venueApi";

export type SupportChatAction = {
  kind: string;
  label: string;
  href?: string | null;
  prompt?: string | null;
  courtSummary?: string | null;
  dateLabel?: string | null;
  timeLabel?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  discountAmount?: number | null;
  pointsValue?: number | null;
  cashAmount?: number | null;
  promoCode?: string | null;
  canPayLater?: boolean | null;
  socialId?: string | null;
};

export const openingChoices: SupportChatAction[] = [
  { kind: "quick_replies", label: "Courts free today", prompt: "Which courts are free today?" },
  { kind: "quick_replies", label: "Courts free tomorrow", prompt: "Which courts are free tomorrow?" },
  { kind: "quick_replies", label: "Join a social", prompt: "What public socials can I join?" },
  { kind: "quick_replies", label: "How points work", prompt: "Please explain how reward points go from pending to available to spend." },
  { kind: "quick_replies", label: "Cancellation policy", prompt: "What is the cancellation policy?" },
  { kind: "quick_replies", label: "My points", prompt: "How many reward points do I have?" },
];

export function SupportChatActions({
  actions,
  sending,
  showReplies,
  onPrompt,
  onClose,
}: {
  actions?: SupportChatAction[];
  sending: boolean;
  showReplies: boolean;
  onPrompt: (text: string) => void;
  onClose?: () => void;
}) {
  const items = actions ?? [];
  const login = items.find((action) => action.kind === "login_link" && isAppPath(action.href));
  const booking = items.filter((action) => action.kind === "stripe_checkout" || (action.kind === "my_bookings_link" && (action.courtSummary || action.cashAmount != null)));
  const links = showReplies ? items.filter((action) => action.kind === "my_bookings_link" && isAppPath(action.href) && !booking.includes(action)) : [];
  const closes = showReplies ? items.filter((action) => action.kind === "close_chat") : [];
  const replies = showReplies ? items.filter((action) => action.kind === "quick_replies" && (action.prompt || action.label).trim().length > 0) : [];
  if (!login && booking.length === 0 && replies.length === 0 && links.length === 0 && closes.length === 0) return null;

  return (
    <div className="space-y-2">
      {login ? <SignInCard action={login} /> : null}
      {booking.length > 0 ? <BookingCard actions={booking} /> : null}
      {replies.length > 0 || links.length > 0 || closes.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Suggested replies">
          {links.map((action) => (
            <Link key={action.label} to={action.href!} className={`${buttonClass("secondary", "sm")} ${sending ? "pointer-events-none opacity-60" : ""}`} aria-disabled={sending || undefined} onClick={(event) => { if (sending) event.preventDefault(); }}>
              {action.label}
            </Link>
          ))}
          <QuickReplies actions={replies} sending={sending} onPrompt={onPrompt} />
          {closes.map((action) => (
            <Button key={action.label} type="button" size="sm" variant="secondary" disabled={sending} onClick={() => onClose?.()}>
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SignInCard({ action }: { action: SupportChatAction }) {
  return (
    <div className="rounded-2xl border border-border bg-canvas p-3">
      <p className="text-sm text-fg">Sign in to hold a court or join a social.</p>
      <Link to={action.href!} className={`${buttonClass("primary", "sm")} mt-2`}>
        {action.label || "Sign in to continue"}
      </Link>
    </div>
  );
}

function BookingCard({ actions }: { actions: SupportChatAction[] }) {
  const [opening, setOpening] = useState(false);
  const details = actions.find((action) => action.courtSummary || action.dateLabel || action.cashAmount != null) ?? actions[0];
  const checkout = actions.find((action) => action.kind === "stripe_checkout" && isStripeUrl(action.href));
  const bookings = actions.find((action) => action.kind === "my_bookings_link" && isAppPath(action.href));
  const bookingsHref = bookings?.href || "/profile/bookings";
  const currency = details.currency || "AUD";
  const cash = details.cashAmount;
  const confirmed = checkout == null && cash != null && cash <= 0;

  return (
    <div className="rounded-2xl border border-border bg-canvas p-3">
      <p className="text-sm font-semibold text-fg">{details.courtSummary || "Your booking"}</p>
      {details.dateLabel || details.timeLabel ? (
        <p className="mt-1 text-sm text-fg-muted">{[details.dateLabel, details.timeLabel].filter(Boolean).join(" · ")}</p>
      ) : null}
      <dl className="mt-2 space-y-1 text-sm text-fg">
        {details.subtotal != null ? <Row label="Subtotal" value={<Money amount={details.subtotal} currency={currency} />} /> : null}
        {details.discountAmount != null && details.discountAmount > 0 ? <Row label="Discount" value={<Money amount={details.discountAmount} currency={currency} />} /> : null}
        {details.pointsValue != null && details.pointsValue > 0 ? <Row label="Points" value={<Money amount={details.pointsValue} currency={currency} />} /> : null}
        {cash != null ? <Row label="To pay" value={<Money amount={cash} currency={currency} />} /> : null}
      </dl>
      {details.promoCode ? <p className="mt-2 text-sm text-fg">Code {details.promoCode}</p> : null}
      <p className="mt-2 text-sm text-fg-muted">{reminder(details, Boolean(checkout), confirmed)}</p>
      <div className="mt-3 flex flex-col gap-2">
        {checkout ? (
          <Button type="button" loading={opening} disabled={opening} onClick={() => { setOpening(true); window.location.assign(checkout.href!); }}>
            Pay now with Stripe
          </Button>
        ) : null}
        <Link to={bookingsHref} className={buttonClass("secondary", "md")}>
          {bookings?.label || (confirmed ? "View in My Bookings" : "Pay in My Bookings")}
        </Link>
      </div>
    </div>
  );
}

function QuickReplies({ actions, sending, onPrompt }: { actions: SupportChatAction[]; sending: boolean; onPrompt: (text: string) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (!sending) setPending(null);
  }, [sending]);

  return (
    <>
      {actions.map((action) => {
        const text = (action.prompt || action.label).trim();
        const named = text.match(/\bApply promotion code\s+([A-Za-z0-9]+)/i)?.[1] ?? action.label.match(/^Apply\s+([A-Za-z0-9]+)$/i)?.[1];
        const both = /apply the promotion code and redeem/i.test(text) ? actions.find((item) => /^Apply\s+[A-Za-z0-9]+$/i.test(item.label))?.label.match(/^Apply\s+([A-Za-z0-9]+)$/i)?.[1] : null;
        return (
          <Button
            key={`${action.label}-${text}`}
            type="button"
            size="sm"
            variant="secondary"
            loading={sending && pending === text}
            disabled={sending}
            onClick={() => {
              const code = named || both;
              if (code) rememberCourtPromo(code);
              if (/redeem my reward points/i.test(text)) rememberPointShare(100);
              if (/without a promotion code/i.test(text)) {
                rememberPointShare(null);
                try {
                  sessionStorage.removeItem("shuttle-sync-promo-latest");
                } catch {
                  // Storage can be unavailable. The pay page then leaves the code unset.
                }
              }
              setPending(text);
              onPrompt(text);
            }}
          >
            {action.label}
          </Button>
        );
      })}
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function reminder(action: SupportChatAction, payingNow: boolean, confirmed: boolean) {
  if (confirmed) return "This booking is confirmed.";
  if (action.canPayLater || !payingNow) return "Pay at least 24 hours before play, or this hold is released.";
  return "An unpaid hold lasts 30 minutes.";
}

function isAppPath(href?: string | null) {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

function isStripeUrl(href?: string | null) {
  return typeof href === "string" && href.startsWith("https://");
}

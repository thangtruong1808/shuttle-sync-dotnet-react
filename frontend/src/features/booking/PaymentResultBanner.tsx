import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Alert, buttonClass } from "../../components/ui";

export type PaymentResultKind = "waiting" | "processing" | "failed" | "cancelled";

type Props = {
  kind: PaymentResultKind;
  /** What was being paid for — used in copy only. */
  subject?: "court" | "courts" | "seat" | "seats" | "places";
  retryTo?: string;
  /** Prefer this when retry stays on the same route and must clear local state. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

function subjectLabel(subject: NonNullable<Props["subject"]>) {
  switch (subject) {
    case "court":
      return { one: "court", place: "court booking" };
    case "courts":
      return { one: "courts", place: "court booking" };
    case "seat":
      return { one: "seat", place: "registration" };
    case "seats":
      return { one: "seats", place: "registration" };
    case "places":
      return { one: "places", place: "registration" };
  }
}

function Retry({ onRetry, retryTo, retryLabel }: { onRetry?: () => void; retryTo?: string; retryLabel: string }) {
  const className = buttonClass("primary", "md", "w-full sm:w-auto");
  if (onRetry) {
    return (
      <button type="button" className={className} onClick={onRetry}>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        {retryLabel}
      </button>
    );
  }
  if (!retryTo) return null;
  return (
    <Link to={retryTo} className={className}>
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
      {retryLabel}
    </Link>
  );
}

function NextSteps({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-col gap-2 sm:flex-row">{children}</div>;
}

export function PaymentResultBanner({ kind, subject = "courts", retryTo, onRetry, retryLabel = "Try again", className = "" }: Props) {
  const labels = subjectLabel(subject);

  if (kind === "waiting") {
    return (
      <Alert tone="info" title="Checking your payment with Stripe" className={className}>
        <p>
          Your {labels.place} is not confirmed yet. We only save it after Stripe confirms the payment. Please wait a moment — do not close this page.
        </p>
      </Alert>
    );
  }

  if (kind === "processing") {
    return (
      <Alert tone="warning" title="Waiting for the bank to confirm" className={className}>
        <p>
          Stripe received the payment, but it is not confirmed yet. Your {labels.one} stay held until the bank confirms. Direct debit can take a few business days. PayTo can take a few minutes. The {labels.place} is only secured after confirmation.
        </p>
        <NextSteps>
          <Link to="/profile/bookings" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent-text hover:underline">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            View my bookings
          </Link>
        </NextSteps>
      </Alert>
    );
  }

  const cancelled = kind === "cancelled";
  return (
    <Alert tone="danger" title={cancelled ? "Payment was cancelled" : "Payment could not go through"} className={className}>
      <p>
        {cancelled
          ? `The Stripe checkout was cancelled, so this ${labels.place} was not saved. No card charge was completed.`
          : `Stripe did not confirm this payment, so this ${labels.place} was not saved. Any reward points used for this attempt are back.`}
      </p>
      <p className="mt-2">Courts and places are only booked after Stripe confirms success.</p>
      <NextSteps>
        <Retry onRetry={onRetry} retryTo={retryTo} retryLabel={retryLabel} />
        <Link to="/profile/bookings" className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
          My bookings
        </Link>
      </NextSteps>
    </Alert>
  );
}

export function paymentOutcomeKind(row: { status: string; paymentStatus: string | null; cashAmount?: number }): PaymentResultKind | "confirmed" | null {
  if (row.status === "confirmed") return "confirmed";
  if (row.status === "waitlist") {
    if (row.paymentStatus === "failed") return "failed";
    if (row.paymentStatus === "cancelled") return "cancelled";
    if (row.paymentStatus === "succeeded" || (row.cashAmount ?? 0) === 0) return "confirmed";
    return "processing";
  }
  if (row.status === "cancelled" || row.paymentStatus === "cancelled") return "cancelled";
  if (row.status === "expired" || row.paymentStatus === "failed") return "failed";
  if (row.paymentStatus === "processing" || row.paymentStatus === "pending" || row.status === "pending") return "processing";
  return null;
}

export function paymentSettled(row: { status: string; paymentStatus: string | null; cashAmount?: number }) {
  const kind = paymentOutcomeKind(row);
  return kind === "confirmed" || kind === "failed" || kind === "cancelled";
}

const returnParams = ["checkout", "redirect_status", "payment_intent", "payment_intent_client_secret"];

/**
 * Drops the Stripe return query from the address bar once the page has a final answer.
 * Uses `history.replaceState` so the router keeps the original search and the page logic
 * that reads it is unchanged. A pending result keeps the query so a refresh checks again.
 */
export function useCleanReturnUrl(waiting: boolean, outcome: { status: string; paymentStatus: string | null; cashAmount?: number } | null) {
  const settled = outcome ? paymentSettled(outcome) : false;
  useEffect(() => {
    const url = new URL(window.location.href);
    const returned = url.searchParams.get("checkout");
    if (!returned || returned.startsWith("friends") || waiting) return;
    if (returned !== "cancel" && !settled) return;
    returnParams.forEach((name) => url.searchParams.delete(name));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [waiting, settled]);
}

import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CircleAlert, Clock, ShieldCheck } from "lucide-react";
import { Spinner } from "../../components/ui";

export type PaymentResultKind = "waiting" | "processing" | "failed" | "cancelled";

type Props = {
  kind: PaymentResultKind;
  /** What was being paid for — used in copy only. */
  subject?: "court" | "courts" | "seat" | "seats" | "places";
  retryTo?: string;
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

export function PaymentResultBanner({ kind, subject = "courts", retryTo, retryLabel = "Try again", className = "" }: Props) {
  const labels = subjectLabel(subject);

  if (kind === "waiting") {
    return (
      <section className={`rounded-3xl border border-sky-300/35 bg-sky-400/10 p-4 sm:p-5 ${className}`} role="status" aria-live="polite">
        <p className="flex items-start gap-2 font-semibold text-sky-100">
          <Spinner className="mt-0.5 h-5 w-5 shrink-0 text-sky-200" />
          Checking your payment with Stripe
        </p>
        <p className="mt-2 text-sm leading-relaxed text-mist/85">
          Your {labels.place} is not confirmed yet. We only save it after Stripe confirms the payment. Please wait a moment — do not close this page.
        </p>
      </section>
    );
  }

  if (kind === "processing") {
    return (
      <section className={`rounded-3xl border border-amber-300/40 bg-amber-400/10 p-4 sm:p-5 ${className}`} role="status" aria-live="polite">
        <p className="flex items-start gap-2 font-semibold text-amber-50">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden="true" />
          Waiting for the bank to confirm
        </p>
        <p className="mt-2 text-sm leading-relaxed text-mist/85">
          Stripe received the payment, but it is not confirmed yet. Your {labels.one} stay held until the bank confirms. Direct debit can take a few business days. PayTo can take a few minutes. The {labels.place} is only secured after confirmation.
        </p>
        <Link to="/profile/bookings" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-line hover:underline">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          View my bookings
        </Link>
      </section>
    );
  }

  const cancelled = kind === "cancelled";
  return (
    <section className={`rounded-3xl border border-rose-300/40 bg-rose-500/10 p-4 sm:p-5 ${className}`} role="alert">
      <p className="flex items-start gap-2 font-semibold text-rose-100">
        <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" aria-hidden="true" />
        {cancelled ? "Payment was cancelled" : "Payment could not go through"}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-mist/85">
        {cancelled
          ? `The Stripe checkout was cancelled, so this ${labels.place} was not saved. No card charge was completed.`
          : `Stripe did not confirm this payment, so this ${labels.place} was not saved. Any reward points used for this attempt are back.`}
      </p>
      <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-mist/75">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mist/50" aria-hidden="true" />
        <span>Courts and places are only booked after Stripe confirms success.</span>
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {retryTo ? (
          <Link
            to={retryTo}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto"
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            {retryLabel}
          </Link>
        ) : null}
        <Link
          to="/profile/bookings"
          className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-mist hover:bg-white/10 sm:w-auto"
        >
          My bookings
        </Link>
      </div>
    </section>
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

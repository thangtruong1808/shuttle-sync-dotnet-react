import { useState } from "react";
import { Tag } from "lucide-react";
import { Money, formatVenueDateTime } from "../../components/format";
import type { Promotion } from "../venues/venueApi";

export function HomePromos({
  promotions,
  loading,
  currency,
  timeZone,
}: {
  promotions: Promotion[] | null;
  loading: boolean;
  currency: string;
  timeZone: string;
}) {
  return (
    <div id="promotions" className="w-full border-t border-white/20 pt-5 md:w-72 md:shrink-0 md:border-l md:border-t-0 md:pl-8 md:pt-0 lg:w-80 xl:w-96 reveal-right" aria-labelledby="promotions-heading">
      <h2 id="promotions-heading" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#c6f54e]">
        <Tag className="h-4 w-4" aria-hidden="true" />
        Promotion codes
      </h2>
      {loading && promotions === null ? (
        <div className="mt-3 space-y-2" aria-busy="true">
          <span className="sr-only">Loading promotions</span>
          <div className="h-5 w-24 animate-pulse rounded bg-white/15" />
          <div className="h-4 w-full animate-pulse rounded bg-white/10" />
        </div>
      ) : promotions && promotions.length > 0 ? (
        <ul className="mt-3 max-h-64 space-y-4 overflow-y-auto">
          {promotions.map((promotion) => (
            <li key={promotion.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-all font-display text-xl font-semibold text-white sm:text-2xl">{promotion.code}</p>
                  <p className="mt-1 text-sm font-semibold text-[#c6f54e]">
                    {promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={currency} />}
                    {promotion.venueId ? "" : " · all venues"}
                  </p>
                </div>
                <CopyCode code={promotion.code} />
              </div>
              {promotion.validFrom && promotion.validTo ? (
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  Valid from {formatVenueDateTime(promotion.validFrom, timeZone)} to {formatVenueDateTime(promotion.validTo, timeZone)}.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-white/70">No active promotion codes right now.</p>
      )}
    </div>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-white/40 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/10"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}

import type { ReactNode } from "react";
import { Badge } from "../../components/ui";
import { CourtImage, Money } from "../../components/format";

export function CourtCard({
  name,
  number,
  surface,
  imageUrl,
  currency,
  hourlyRate,
  heading = "h3",
  children,
}: {
  name: string;
  number: number;
  surface: string | null;
  imageUrl: string | null;
  currency: string;
  hourlyRate: number;
  heading?: "h2" | "h3";
  children?: ReactNode;
}) {
  const Title = heading;
  return (
    <article className="flex h-full flex-col rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none">
      <CourtImage src={imageUrl} alt={`${name} court`} />
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Title className="truncate font-display text-xl text-fg">{name || `Court ${number}`}</Title>

        </div>
        {surface ? <Badge>{surface}</Badge> : null}
      </div>
      <p className="mt-2 text-sm tabular-nums text-fg">
        From <span className="font-semibold"><Money amount={hourlyRate} currency={currency} /></span>
        <span className="text-fg-muted"> / hour</span>
      </p>
      {children}
    </article>
  );
}

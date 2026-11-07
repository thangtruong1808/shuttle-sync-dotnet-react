import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui";

const rewardPageSizes = [5, 10, 20, 50] as const;

export function ListPager({
  page,
  pageSize,
  total,
  unit,
  loading,
  pageMove,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  unit?: string;
  loading: boolean;
  pageMove: string | null;
  onPage: (page: number, move: string) => void;
  onPageSize: (size: number) => void;
}) {
  const size = Math.max(pageSize, 1);
  const pages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, pages);
  const from = total === 0 ? 0 : (safePage - 1) * size + 1;
  const to = Math.min(total, safePage * size);
  const windowStart = Math.max(1, safePage - 2);
  const windowEnd = Math.min(pages, windowStart + 4);
  const numbers = Array.from({ length: windowEnd - windowStart + 1 }, (_, index) => windowStart + index);
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-inset px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-fg" aria-live="polite">View {from}–{to} of {total}{unit ? ` ${unit}` : ""}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {rewardPageSizes.map((option) => (
            <Button
              key={option}
              variant={option === pageSize ? "primary" : "secondary"}
              className="min-w-11 px-2.5"
              aria-label={`View ${option} per page`}
              aria-pressed={option === pageSize}
              loading={pageMove === `size-${option}`}
              disabled={option === pageSize || loading}
              onClick={() => onPageSize(option)}
            >
              {option}
            </Button>
          ))}
          <span className="text-sm text-fg/80">per page</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "prev"} disabled={safePage <= 1 || loading} onClick={() => onPage(safePage - 1, "prev")}>Previous</Button>
        {numbers.map((number) => (
          <Button
            key={number}
            variant={number === safePage ? "primary" : "secondary"}
            className="min-w-11 px-2.5"
            aria-label={`Page ${number}`}
            aria-current={number === safePage ? "page" : undefined}
            loading={loading && pageMove === `page-${number}`}
            disabled={number === safePage || loading}
            onClick={() => onPage(number, `page-${number}`)}
          >
            {number}
          </Button>
        ))}
        <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "next"} disabled={safePage >= pages || loading} onClick={() => onPage(safePage + 1, "next")}>Next</Button>
        <span className="text-sm text-fg/70">Page {safePage} of {pages}</span>
      </div>
    </div>
  );
}

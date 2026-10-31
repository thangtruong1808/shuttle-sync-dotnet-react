import { useEffect, useState } from "react";
import { Spinner } from "../../components/ui";
import { phraseWeekCopy, type WeekFacts } from "./profileApi";

export function WeekReason({ facts, fallback }: { facts: WeekFacts; fallback: string }) {
  const [text, setText] = useState(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setText(fallback);
    setLoading(true);
    let live = true;
    phraseWeekCopy(facts)
      .then((message) => {
        if (live && message) setText(message);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [facts, fallback]);

  return (
    <p className="mt-2 flex items-start gap-2 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium leading-relaxed text-rose-800 dark:text-rose-100" role="alert" aria-busy={loading}>
      {loading ? <Spinner className="mt-1 h-3.5 w-3.5 shrink-0" /> : null}
      <span>{text}</span>
    </p>
  );
}

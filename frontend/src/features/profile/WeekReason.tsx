import { useEffect, useState } from "react";
import { phraseWeekCopy, type WeekFacts } from "./profileApi";

export function WeekReason({ facts, fallback }: { facts: WeekFacts; fallback: string }) {
  const [text, setText] = useState(fallback);

  useEffect(() => {
    setText(fallback);
    let live = true;
    phraseWeekCopy(facts)
      .then((message) => {
        if (live && message) setText(message);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [facts, fallback]);

  return <p className="mt-2 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium leading-relaxed text-rose-100" role="alert">{text}</p>;
}

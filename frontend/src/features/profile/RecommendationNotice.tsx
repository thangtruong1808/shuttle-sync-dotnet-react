import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import type { RootState } from "../../app/store";
import { recommendationListeners as listeners, unreadRecommendations } from "./profileApi";

export function useUnreadRecommendations() {
  const status = useSelector((state: RootState) => state.auth.status);
  const location = useLocation();
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      setCount(0);
      return;
    }
    let live = true;
    unreadRecommendations()
      .then((result) => {
        if (live) setCount(result.count);
      })
      .catch(() => {
        if (live) setCount(0);
      });
    return () => {
      live = false;
    };
  }, [status, location.pathname, tick]);

  return count;
}

export function RecommendationBell() {
  const count = useUnreadRecommendations();
  if (count === 0) return null;
  const label = count === 1 ? "1 new recommendation" : `${count} new recommendations`;
  return (
    <NavLink
      to="/profile/recommendations"
      title={label}
      aria-label={label}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-accent-text/40 text-accent-text hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text"
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">
        {count}
      </span>
    </NavLink>
  );
}

export function RecommendationBanner() {
  const count = useUnreadRecommendations();
  if (count === 0) return null;
  const label = count === 1 ? "1 new recommendation" : `${count} new recommendations`;
  const stay = count === 1 ? "It stays unread until you mark it read." : "They stay unread until you mark them read.";
  return (
    <section className="mt-4 rounded-2xl border border-accent-text/40 bg-accent/10 px-4 py-3 text-sm text-accent-text" role="status" aria-label="New recommendations">
      <p className="flex items-start gap-2 font-medium">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>A venue wrote {label} for you. {stay}</span>
      </p>
      <Link className="mt-2 inline-flex font-semibold text-fg underline decoration-accent-text underline-offset-4 hover:text-accent-text" to="/profile/recommendations">
        Open recommendations
      </Link>
    </section>
  );
}

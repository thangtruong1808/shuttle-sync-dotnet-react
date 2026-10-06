import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDispatch } from "react-redux";
import { Outlet } from "react-router-dom";
import type { AppDispatch } from "../../app/store";
import { loadCurrentUser } from "../../features/auth/authSlice";
import { listVenues, readDefaultVenueSlug, writeDefaultVenueSlug, type Venue } from "../../features/venues/venueApi";
import { Footer } from "./Footer";
import { Navbar } from "./Navbar";

type VenueState = {
  venues: Venue[] | null;
  error: string | null;
  reload: () => void;
  defaultSlug: string | null;
  setDefaultVenue: (slug: string | null) => void;
};

const VenueContext = createContext<VenueState>({
  venues: null,
  error: null,
  reload: () => undefined,
  defaultSlug: null,
  setDefaultVenue: () => undefined,
});

export function useVenues() {
  return useContext(VenueContext);
}

export function SiteLayout() {
  const dispatch = useDispatch<AppDispatch>();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [defaultSlug, setDefaultSlug] = useState<string | null>(() => readDefaultVenueSlug());

  function setDefaultVenue(slug: string | null) {
    writeDefaultVenueSlug(slug);
    setDefaultSlug(slug);
  }

  useEffect(() => {
    void dispatch(loadCurrentUser());
  }, [dispatch]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    listVenues()
      .then((items) => {
        if (!controller.signal.aborted) {
          setVenues(items);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setVenues([]);
          setError("Venues could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!venues) return;
    if (venues.length === 1) {
      const only = venues[0].slug;
      if (defaultSlug !== only) setDefaultVenue(only);
      return;
    }
    if (defaultSlug && !venues.some((venue) => venue.slug === defaultSlug)) {
      setDefaultVenue(null);
    }
  }, [venues, defaultSlug]);

  return (
    <VenueContext.Provider value={{ venues, error, reload: () => setAttempt((value) => value + 1), defaultSlug, setDefaultVenue }}>
      <div className="flex min-h-screen flex-col bg-ink text-mist">
        <Navbar />
        <div className="flex-1">
          <Outlet />
        </div>
        <Footer />
      </div>
    </VenueContext.Provider>
  );
}

export function PageSection({ children }: { children: ReactNode }) {
  return <div className="w-full px-4 py-8 sm:px-6 lg:px-8">{children}</div>;
}

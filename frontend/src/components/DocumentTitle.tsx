import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { venueDetail } from "../features/dashboard/dashboardApi";
import { reservedSlugs } from "../features/venues/slug";
import { listVenues, readDefaultVenueSlug } from "../features/venues/venueApi";

const brand = "Shuttle Sync";
const description = "Book a badminton court or join a public social. Shuttle Sync keeps the schedule, the payment, and the points in one place.";

const staticPages: Record<string, string> = {
  "/": "Home",
  "/login": "Log in",
  "/register": "Sign up",
  "/promotions": "Promotions",
  "/rewards": "Rewards",
  "/faq": "FAQ",
  "/contact": "Contact",
  "/cancellation": "Cancellation policy",
  "/terms": "Terms",
  "/privacy": "Privacy",
  "/profile": "Overview",
  "/profile/details": "Personal info",
  "/profile/bookings": "My bookings",
  "/profile/friend-spots": "Friend spots",
  "/profile/rewards": "Reward points",
  "/profile/payments": "Payments & refunds",
  "/profile/recommendations": "Recommendations",
  "/profile/security": "Security",
  "/dashboard": "Overview",
  "/dashboard/venues": "Venues",
  "/dashboard/users": "Users",
  "/dashboard/bookings": "Bookings",
  "/dashboard/promotions": "Promotions",
  "/dashboard/payments": "Payments",
  "/dashboard/rewards": "Rewards",
  "/dashboard/activity": "Activity",
  "/dashboard/recommendations": "Recommendations",
};

const slugNames = new Map<string, string>();
const deskNames = new Map<string, string>();
let slugNamesLoad: Promise<void> | null = null;

function loadSlugNames(): Promise<void> {
  slugNamesLoad ??= listVenues()
    .then((rows) => {
      for (const row of rows) slugNames.set(row.slug, row.name);
    })
    .catch(() => undefined);
  return slugNamesLoad;
}

function pageName(path: string): string {
  if (staticPages[path]) return staticPages[path];
  if (path.startsWith("/dashboard/venues/")) {
    if (path.endsWith("/incentives")) return "Incentives";
    if (path.endsWith("/closures")) return "Closures";
    if (path.endsWith("/slots")) return "Slots";
    if (path.endsWith("/rates")) return "Rates";
    if (path.endsWith("/courts")) return "Courts";
    return "Details";
  }
  if (path.startsWith("/dashboard/users/")) return "User";
  if (path.startsWith("/dashboard/bookings")) return "Bookings";
  if (path.startsWith("/dashboard/promotions")) return "Promotions";
  if (path.startsWith("/dashboard/payments")) return "Payments";
  if (path.startsWith("/dashboard/rewards")) return "Rewards";
  if (path.startsWith("/dashboard/activity")) return "Activity";
  if (path.startsWith("/dashboard/recommendations")) return "Recommendations";

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1) return "Home";
  if (parts[1] === "courts") return "Courts";
  if (parts[1] === "book" && parts[2] === "group") return "Secure courts";
  if (parts[1] === "book" && parts.length === 2) return "Book a court";
  if (parts[1] === "book") return "Payment";
  if (parts[1] === "social" && parts[2] === "checkout") return "Social checkout";
  if (parts[1] === "social") return "Public social";
  return "Page not found";
}

function titleFor(page: string, venue: string | null): string {
  return venue ? `${page} · ${venue} · ${brand}` : `${page} · ${brand}`;
}

function setMeta(attr: "name" | "property", key: string, content: string) {
  const node = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (node) node.setAttribute("content", content);
}

async function venueName(path: string): Promise<string | null> {
  const deskId = path.match(/^\/dashboard\/venues\/([0-9a-f-]{36})/i)?.[1];
  if (deskId) {
    const cached = deskNames.get(deskId);
    if (cached) return cached;
    try {
      const row = await venueDetail(deskId);
      deskNames.set(deskId, row.name);
      return row.name;
    } catch {
      return null;
    }
  }

  const parts = path.split("/").filter(Boolean);
  const publicSlug = parts[0] && !reservedSlugs.includes(parts[0]) ? parts[0] : null;
  const profileSlug = path.startsWith("/profile") ? readDefaultVenueSlug() : null;
  const slug = publicSlug ?? profileSlug;
  if (!slug) return null;
  await loadSlugNames();
  return slugNames.get(slug) ?? null;
}

function applyTitle(title: string) {
  document.title = title;
  const image = `${window.location.origin}/icon-512.png`;
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", window.location.origin + window.location.pathname);
  setMeta("property", "og:image", image);
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", image);
  setMeta("name", "description", description);
}

export function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = pageName(pathname);
    let active = true;
    applyTitle(titleFor(page, null));
    void venueName(pathname).then((name) => {
      if (active) applyTitle(titleFor(page, name));
    });
    return () => {
      active = false;
    };
  }, [pathname]);
  return null;
}

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

function pageName(path: string): string {
  if (path === "/") return "Home";
  if (path === "/login") return "Log in";
  if (path === "/register") return "Sign up";
  if (path === "/promotions") return "Promotions";
  if (path === "/rewards") return "Rewards";
  if (path === "/faq") return "FAQ";
  if (path === "/contact") return "Contact";
  if (path === "/cancellation") return "Cancellation policy";
  if (path === "/terms") return "Terms";
  if (path === "/privacy") return "Privacy";
  if (path === "/profile") return "Overview";
  if (path === "/profile/details") return "Personal info";
  if (path === "/profile/bookings") return "My bookings";
  if (path === "/profile/friend-spots") return "Friend spots";
  if (path === "/profile/rewards") return "Reward points";
  if (path === "/profile/payments") return "Payments & refunds";
  if (path === "/profile/security") return "Security";
  if (path === "/dashboard") return "Overview";
  if (path === "/dashboard/venues") return "Venues";
  if (path.startsWith("/dashboard/venues/")) {
    if (path.endsWith("/incentives")) return "Incentives";
    if (path.endsWith("/closures")) return "Closures";
    if (path.endsWith("/slots")) return "Slots";
    if (path.endsWith("/courts")) return "Courts";
    return "Venue";
  }
  if (path === "/dashboard/users") return "Users";
  if (path.startsWith("/dashboard/users/")) return "User";
  if (path.startsWith("/dashboard/bookings")) return "Bookings";
  if (path.startsWith("/dashboard/promotions")) return "Promotions";
  if (path.startsWith("/dashboard/payments")) return "Payments";
  if (path.startsWith("/dashboard/rewards")) return "Rewards";
  if (path.startsWith("/dashboard/activity")) return "Activity";
  if (path.startsWith("/dashboard/recommendations")) return "Recommendations";

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1) return "Home";
  if (parts.length >= 2) {
    if (parts[1] === "courts") return "Courts";
    if (parts[1] === "book" && parts[2] === "group") return "Secure courts";
    if (parts[1] === "book" && parts.length === 2) return "Book a court";
    if (parts[1] === "book") return "Payment";
    if (parts[1] === "social" && parts[2] === "checkout") return "Social checkout";
    if (parts[1] === "social") return "Public social";
  }
  return "Page not found";
}

export function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = pageName(pathname);
  }, [pathname]);
  return null;
}

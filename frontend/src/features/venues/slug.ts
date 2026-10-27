export const reservedSlugs = [
  "login",
  "register",
  "profile",
  "dashboard",
  "rewards",
  "promotions",
  "faq",
  "contact",
  "cancellation",
  "terms",
  "privacy",
  "api",
  "assets",
];

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function slugError(slug: string): string | null {
  if (!slug) return "Enter a slug for the venue address.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Use lowercase letters, numbers, and single hyphens.";
  if (slug.length > 100) return "Keep the slug under 100 characters.";
  if (reservedSlugs.includes(slug)) return "That address is used by the app. Pick another slug.";
  return null;
}

export function venueAddress(slug: string): string {
  return `${window.location.host}/${slug || "your-venue"}`;
}

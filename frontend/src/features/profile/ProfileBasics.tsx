import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useVenues } from "../../components/layout/SiteLayout";
import { venueForPage } from "../venues/venueApi";
import { CalendarDays, Gift, Save, Users, Wallet } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "../../app/store";
import { formatVenueDay, formatVenueRange, initials } from "../../components/format";
import { Alert, Button, Card, Field, Input, PageHeader, Skeleton, Spinner, StatCard } from "../../components/ui";
import { AuthRequestError, updateProfile, uploadAvatar } from "../auth/authApi";
import { loadCurrentUser, signedIn } from "../auth/authSlice";
import { myBookings, myCourtWeeks, myRewards, type BookingRow, type CourtWeekCourt } from "./profileApi";

type NextBooking = { venueName: string; place: string; startTime: string; endTime: string; timeZone: string };

function soonestBooking(bookings: BookingRow[], holds: CourtWeekCourt[]): NextBooking | null {
  const now = Date.now();
  const options: NextBooking[] = bookings.map((booking) => ({
    venueName: booking.venueName,
    place: booking.courtName,
    startTime: booking.startTime,
    endTime: booking.endTime,
    timeZone: booking.timeZone,
  }));
  const slots = new Map<string, CourtWeekCourt[]>();
  for (const court of holds) {
    if (court.status !== "confirmed" && court.status !== "pending") continue;
    const key = `${court.groupId}|${court.startTime}`;
    slots.set(key, [...(slots.get(key) ?? []), court]);
  }
  for (const courts of slots.values()) {
    const first = courts[0];
    options.push({
      venueName: first.venueName,
      place: [...courts].sort((a, b) => a.courtNumber - b.courtNumber).map((court) => court.courtName).join(", "),
      startTime: first.startTime,
      endTime: first.endTime,
      timeZone: first.timeZone,
    });
  }
  return options
    .filter((option) => new Date(option.startTime).getTime() > now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0] ?? null;
}

export function OverviewSection() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((state: RootState) => state.auth.user);
  const [nextBooking, setNextBooking] = useState<NextBooking | null>(null);
  const [pendingPoints, setPendingPoints] = useState(0);
  const [loadingNext, setLoadingNext] = useState(true);
  const { venues, defaultSlug } = useVenues();
  const [params] = useSearchParams();
  const venue = venueForPage(venues, params.get("venue") ?? undefined, defaultSlug);
  const venueSlug = venue?.slug ?? null;

  useEffect(() => {
    if (venues === null) {
      return;
    }
    let active = true;
    setLoadingNext(true);
    Promise.all([myBookings("upcoming", 1, venueSlug, 50), myCourtWeeks().catch(() => ({ weeks: [] }))])
      .then(([page, holds]) => {
        if (!active) return;
        setNextBooking(soonestBooking(page.items, holds.weeks.filter((court) => !venueSlug || court.venueSlug === venueSlug)));
        void dispatch(loadCurrentUser());
      })
      .catch(() => {
        if (active) setNextBooking(null);
      })
      .finally(() => {
        if (active) setLoadingNext(false);
      });
    return () => {
      active = false;
    };
  }, [dispatch, venues, venueSlug]);

  useEffect(() => {
    myRewards(1)
      .then((page) => {
        setPendingPoints(page.pending);
        void dispatch(loadCurrentUser());
      })
      .catch(() => setPendingPoints(0));
  }, [dispatch]);

  if (!user) {
    return null;
  }
  const name = user.displayName || user.firstName || "there";
  return (
    <div>
      <PageHeader title={`Hello, ${name}`} description={`You have ${user.rewardPoints} reward points ready to use.`} />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <StatCard label="Reward points" value={user.rewardPoints} icon={<Gift className="h-4 w-4" aria-hidden="true" />} hint={pendingPoints > 0 ? <><Link className="font-semibold text-accent-text hover:underline" to="/profile/rewards">{pendingPoints} points</Link> are waiting and join your balance after those sessions end.</> : undefined} />
        <Card title="Next booking" description={loadingNext ? "Loading your next booking" : undefined}>
          {loadingNext ? (
            <div aria-busy="true">
              <span className="sr-only">Loading your next booking</span>
              <Skeleton className="h-12" />
            </div>
          ) : nextBooking ? (
            <p className="text-sm text-fg">
              Next booking: {nextBooking.venueName}, {nextBooking.place}, {formatVenueDay(nextBooking.startTime, nextBooking.timeZone)}, {formatVenueRange(nextBooking.startTime, nextBooking.endTime, nextBooking.timeZone)}
            </p>
          ) : (
            <p className="text-sm text-fg-muted">{venue ? `No upcoming booking at ${venue.name}.` : "No upcoming booking."}</p>
          )}
        </Card>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link className="inline-flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-accent-text/40 dark:shadow-none" to="/profile/bookings"><CalendarDays className="h-4 w-4 text-accent-text" aria-hidden="true" />My bookings</Link>
        <Link className="inline-flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-accent-text/40 dark:shadow-none" to="/profile/friend-spots"><Users className="h-4 w-4 text-accent-text" aria-hidden="true" />Friend spots</Link>
        <Link className="inline-flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-accent-text/40 dark:shadow-none" to="/profile/rewards"><Gift className="h-4 w-4 text-accent-text" aria-hidden="true" />Reward history</Link>
        <Link className="inline-flex items-center gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card hover:border-accent-text/40 dark:shadow-none" to="/profile/payments"><Wallet className="h-4 w-4 text-accent-text" aria-hidden="true" />Payments</Link>
      </div>
    </div>
  );
}

export function DetailsSection() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((state: RootState) => state.auth.user);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [mobile, setMobile] = useState(user?.mobile ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const busy = saving || uploading;

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? "");
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
    setMobile(user.mobile ?? "");
  }, [user?.id, user?.displayName, user?.firstName, user?.lastName, user?.mobile]);

  if (!user) {
    return null;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const next = await updateProfile({ displayName, firstName, lastName, mobile });
      dispatch(signedIn(next));
      setMessage({ tone: "ok", text: "Updated Successfully." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof AuthRequestError ? error.fieldErrors.form?.[0] ?? "Could not save." : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  async function onAvatar(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!isPhotoFile(file) || file.size > 2 * 1024 * 1024) {
      setMessage({ tone: "error", text: "Use a JPEG, PNG, or WebP image up to 2 MB." });
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const next = await uploadAvatar(file);
      dispatch(signedIn(next));
      setMessage({ tone: "ok", text: "Photo updated. It now shows on your account." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof AuthRequestError ? error.fieldErrors.form?.[0] ?? "Could not upload." : "Could not upload." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="max-w-3xl" onSubmit={onSubmit}>
      <PageHeader title="Personal info" description="Update the name, phone number, and photo on your account." />
      <Card>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4 border-b border-border pb-8 sm:flex-row sm:items-center">
            {user.userAvatar ? (
              <img src={user.userAvatar} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-fg/10 text-lg font-semibold text-fg">{initials(user.displayName, user.email)}</span>
            )}
            <div>
              <span className="block text-sm font-medium text-fg" id="profile-photo-label">Photo</span>
              <p className="mt-1 text-sm text-fg-muted">JPEG, PNG, or WebP, up to 2 MB.</p>
              <label className={`group relative mt-3 inline-flex max-w-full rounded-xl focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-text ${busy ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <span className={`pointer-events-none inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-fg shadow-sm ${busy ? "opacity-60" : "group-hover:bg-surface-2"}`} aria-hidden="true">
                  {uploading ? <Spinner /> : null}
                  Upload photo
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  disabled={busy}
                  aria-labelledby="profile-photo-label"
                  aria-busy={uploading}
                  className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void onAvatar(file);
                  }}
                />
              </label>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Display name">{({ id }) => <Input id={id} value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />}</Field>
            <Field label="First name">{({ id }) => <Input id={id} value={firstName} disabled={busy} onChange={(event) => setFirstName(event.target.value)} />}</Field>
            <Field label="Last name">{({ id }) => <Input id={id} value={lastName} disabled={busy} onChange={(event) => setLastName(event.target.value)} />}</Field>
            <Field className="sm:col-span-2" label="Mobile">{({ id }) => <Input id={id} value={mobile} disabled={busy} onChange={(event) => setMobile(event.target.value)} />}</Field>
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
            <span>Email</span>
            <span className="font-medium text-fg">{user.email}</span>
            {user.emailVerified ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-text">Verified</span> : <span className="text-xs text-fg/50">Not verified</span>}
          </p>
          {message ? <Alert tone={message.tone === "ok" ? "success" : "danger"}>{message.text}</Alert> : null}
          <div>
            <Button type="submit" className="w-full sm:w-auto" icon={<Save className="h-4 w-4" aria-hidden="true" />} loading={saving} disabled={uploading}>Save</Button>
          </div>
        </div>
      </Card>
    </form>
  );
}

function isPhotoFile(file: File) {
  const type = file.type.toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/png" || type === "image/webp") {
    return true;
  }
  const name = file.name.toLowerCase();
  return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp");
}


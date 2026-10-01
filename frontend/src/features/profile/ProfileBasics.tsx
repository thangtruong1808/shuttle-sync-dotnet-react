import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "../../app/store";
import { formatVenueRange } from "../../components/format";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { AuthRequestError, updateProfile, uploadAvatar } from "../auth/authApi";
import { logout, signedIn } from "../auth/authSlice";
import { myBookings, type BookingRow } from "./profileApi";

export function OverviewSection() {
  const user = useSelector((state: RootState) => state.auth.user);
  const [nextBooking, setNextBooking] = useState<BookingRow | null>(null);
  const [loadingNext, setLoadingNext] = useState(true);

  useEffect(() => {
    setLoadingNext(true);
    myBookings("upcoming", 1)
      .then((page) => setNextBooking(page.items[0] ?? null))
      .catch(() => setNextBooking(null))
      .finally(() => setLoadingNext(false));
  }, []);

  if (!user) {
    return null;
  }
  const name = user.displayName || user.firstName || "there";
  return (
    <div>
      <h1 className="font-display text-3xl text-white">Hello, {name}</h1>
      <p className="mt-2 text-mist/70">You have {user.rewardPoints} reward points.</p>
      {loadingNext ? (
        <div className="mt-4" aria-busy="true">
          <span className="sr-only">Loading your next booking</span>
          <Skeleton className="h-12" />
        </div>
      ) : nextBooking ? (
        <p className="mt-4 rounded-2xl border border-white/10 px-4 py-3 text-sm text-mist">
          Next booking: {nextBooking.venueName}, {nextBooking.courtName}, {formatVenueRange(nextBooking.startTime, nextBooking.endTime, nextBooking.timeZone)}
        </p>
      ) : (
        <p className="mt-4 text-sm text-mist/70">No upcoming booking.</p>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Link className="rounded-2xl border border-white/10 p-4 hover:border-line/40" to="/profile/bookings">My bookings</Link>
        <Link className="rounded-2xl border border-white/10 p-4 hover:border-line/40" to="/profile/rewards">Reward history</Link>
        <Link className="rounded-2xl border border-white/10 p-4 hover:border-line/40" to="/profile/payments">Payments</Link>
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
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const busy = saving || uploading;

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
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(error instanceof AuthRequestError ? error.fieldErrors.form?.[0] ?? "Could not save." : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function onAvatar(file: File | undefined) {
    if (!file) {
      return;
    }
    if (!isPhotoFile(file) || file.size > 2 * 1024 * 1024) {
      setMessage("Use a JPEG, PNG, or WebP image up to 2 MB.");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const next = await uploadAvatar(file);
      dispatch(signedIn(next));
      setMessage("Photo updated.");
    } catch (error) {
      setMessage(error instanceof AuthRequestError ? error.fieldErrors.form?.[0] ?? "Could not upload." : "Could not upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="max-w-xl space-y-4" onSubmit={onSubmit}>
      <h1 className="font-display text-3xl text-white">Personal info</h1>
      <div className="text-sm">
        <span className="mb-1 block text-mist/70" id="profile-photo-label">Photo</span>
        <label className={`group relative inline-flex max-w-full rounded-xl focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-line ${busy ? "cursor-not-allowed" : "cursor-pointer"}`}>
          <span className={`pointer-events-none inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-mist ${busy ? "opacity-60" : "group-hover:bg-white/10"}`} aria-hidden="true">
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
      <Field label="Display name" value={displayName} onChange={setDisplayName} disabled={busy} />
      <Field label="First name" value={firstName} onChange={setFirstName} disabled={busy} />
      <Field label="Last name" value={lastName} onChange={setLastName} disabled={busy} />
      <Field label="Mobile" value={mobile} onChange={setMobile} disabled={busy} />
      <p className="text-sm text-mist/70">
        Email <span className="text-white">{user.email}</span>
        {user.emailVerified ? <span className="ml-2 rounded-full bg-line/15 px-2 py-0.5 text-xs font-semibold text-line">Verified</span> : <span className="ml-2 text-xs text-mist/50">Not verified</span>}
      </p>
      {message ? <p className="text-sm text-mist" role="status">{message}</p> : null}
      <Button type="submit" loading={saving} disabled={uploading}>Save</Button>
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

function Field({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-mist/70">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

export function LogoutSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [leaving, setLeaving] = useState(false);
  return (
    <div>
      <h1 className="font-display text-3xl text-white">Log out</h1>
      <p className="mt-2 text-sm text-mist/70">This signs you out on this device.</p>
      <Button
        className="mt-4"
        variant="danger"
        loading={leaving}
        onClick={() => {
          setLeaving(true);
          void dispatch(logout()).finally(() => setLeaving(false));
        }}
      >
        Log out
      </Button>
    </div>
  );
}

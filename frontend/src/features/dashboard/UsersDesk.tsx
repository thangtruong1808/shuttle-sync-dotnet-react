import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { EmptyState, ErrorState, formatVenueDateTime } from "../../components/format";
import { Button, Skeleton } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";
import {
  assignVenue,
  DashError,
  deleteUser,
  listUsers,
  revokeDevice,
  unassignVenue,
  updateUser,
  userDetail,
  type DashUser,
  type DashUserDetail,
} from "./dashboardApi";
import { control, Field, Notice, Pager, Success, useBusy } from "./dashboardUi";

export function UsersPage() {
  const location = useLocation();
  const arrived = location.state as { success?: string } | null;
  const [success, setSuccess] = useState<string | null>(arrived?.success ?? null);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<DashUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    listUsers(applied, page)
      .then((result) => {
        if (!active) return;
        setRows(result.items);
        setTotal(result.total);
        setPageSize(result.pageSize);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "Users could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [applied, attempt, page]);

  return (
    <div>
      <h1 className="font-display text-3xl text-white">Users</h1>
      <div className="mt-4"><Success message={success} /></div>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run("filter", async () => {
            setPage(1);
            setApplied(query.trim());
            setSuccess("Search updated.");
            setAttempt((value) => value + 1);
          });
        }}
      >
        <input className={`${control} max-w-sm`} placeholder="Name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Button type="submit" variant="secondary" loading={busy === "filter"}>Search</Button>
      </form>
      {error ? (
        <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
      ) : rows === null ? (
        <div className="mt-6" aria-busy="true"><span className="sr-only">Loading users</span><Skeleton className="h-40" /></div>
      ) : rows.length === 0 ? (
        <div className="mt-6"><EmptyState title="No users" body="Try another name or email." /></div>
      ) : (
        <ul className="mt-6 grid gap-2">
          {rows.map((user) => (
            <li key={user.id}>
              <Link to={`/dashboard/users/${user.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 px-4 py-3 hover:bg-white/5">
                <span className="text-white">{user.displayName || user.email}</span>
                <span className="text-sm text-mist/65">{user.role} · {user.rewardPoints} pts</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows ? <Pager page={page} pageSize={pageSize} total={total} busy={busy} onPage={(next, key) => { void run(key, async () => setPage(next)); }} /> : null}
    </div>
  );
}

export function UserDesk() {
  const { userId = "" } = useParams();
  const [detail, setDetail] = useState<DashUserDetail | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [venueId, setVenueId] = useState("");
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    Promise.all([userDetail(userId), dashboardVenues()])
      .then(([user, list]) => {
        if (!active) return;
        setDetail(user);
        setVenues(list);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "That user could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, userId]);

  if (error) return <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} />;
  if (!detail) return <div aria-busy="true"><span className="sr-only">Loading user</span><Skeleton className="h-40" /></div>;

  const user = detail.user;
  const assigned = new Set(detail.venues.map((venue) => venue.id));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-display text-3xl text-white">{user.displayName || user.email}</h1>
        <p className="text-sm text-mist/65">{user.email} · {user.rewardPoints} pts</p>
      </div>
      <form
        key={`${user.displayName ?? ""}:${user.role}:${user.mobile ?? ""}`}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setMessage(null);
          setSuccess(null);
          void run("save", async () => {
            try {
              await updateUser(user.id, {
                displayName: String(data.get("displayName") || "") || null,
                firstName: String(data.get("firstName") || "") || null,
                lastName: String(data.get("lastName") || "") || null,
                mobile: String(data.get("mobile") || "") || null,
                role: String(data.get("role") || "user"),
              });
              setSuccess("User saved.");
              setAttempt((value) => value + 1);
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The user could not be saved.");
            }
          });
        }}
      >
        <Field label="Display name"><input name="displayName" className={control} defaultValue={user.displayName ?? ""} disabled={busy !== null} /></Field>
        <Field label="First name"><input name="firstName" className={control} defaultValue={user.firstName ?? ""} disabled={busy !== null} /></Field>
        <Field label="Last name"><input name="lastName" className={control} defaultValue={user.lastName ?? ""} disabled={busy !== null} /></Field>
        <Field label="Mobile"><input name="mobile" className={control} defaultValue={user.mobile ?? ""} disabled={busy !== null} /></Field>
        <Field label="Role">
          <select name="role" className={control} defaultValue={user.role} disabled={busy !== null}>
            <option value="user">user</option>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
          </select>
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" loading={busy === "save"} disabled={busy !== null && busy !== "save"}>Save</Button>
          <Button variant="danger" loading={busy === "delete"} disabled={busy !== null && busy !== "delete"} onClick={() => {
            void run("delete", async () => {
              try {
                await deleteUser(user.id);
                navigate("/dashboard/users", { state: { success: "User deleted." } });
              } catch (reason) {
                setMessage(reason instanceof DashError ? reason.message : "The user could not be deleted.");
              }
            });
          }}>Delete</Button>
        </div>
        <div className="sm:col-span-2 flex flex-wrap gap-2"><Notice message={message} /><Success message={success} /></div>
      </form>
      <section>
        <h2 className="font-display text-xl text-white">Assigned venues</h2>
        {user.role !== "staff" ? <p className="mt-2 text-sm text-mist/65">Change the role to staff before assigning a venue.</p> : null}
        <ul className="mt-3 grid gap-2">
          {detail.venues.map((venue) => (
            <li key={venue.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
              <span className="text-mist">{venue.name}</span>
              <Button variant="secondary" loading={busy === venue.id} disabled={busy !== null && busy !== venue.id} onClick={() => {
                void run(venue.id, async () => {
                  setMessage(null);
                  setSuccess(null);
                  try {
                    await unassignVenue(user.id, venue.id);
                    setSuccess("Venue unassigned.");
                    setAttempt((value) => value + 1);
                  } catch (reason) {
                    setMessage(reason instanceof DashError ? reason.message : "The venue could not be removed.");
                  }
                });
              }}>Unassign</Button>
            </li>
          ))}
        </ul>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!venueId) return;
          setMessage(null);
          setSuccess(null);
          void run("assign", async () => {
            try {
              await assignVenue(user.id, venueId);
              setSuccess("Venue assigned.");
              setAttempt((value) => value + 1);
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The venue could not be assigned.");
            }
          });
        }}>
          <select className={`${control} max-w-sm`} value={venueId} disabled={busy !== null} onChange={(event) => setVenueId(event.target.value)}>
            <option value="">Choose a venue</option>
            {venues.filter((venue) => !assigned.has(venue.id)).map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
          <Button type="submit" loading={busy === "assign"} disabled={!venueId || (busy !== null && busy !== "assign")}>Assign</Button>
        </form>
      </section>
      <section>
        <h2 className="font-display text-xl text-white">Linked accounts</h2>
        {detail.logins.length === 0 ? <p className="mt-2 text-sm text-mist/65">No linked accounts.</p> : (
          <ul className="mt-2 text-sm text-mist">{detail.logins.map((login) => <li key={login.provider}>{login.provider} · {login.emailAtLink || "no email"}</li>)}</ul>
        )}
      </section>
      <section>
        <h2 className="font-display text-xl text-white">Sessions</h2>
        <ul className="mt-2 grid gap-2">
          {detail.sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-mist">
              <span>{session.userAgent || "Unknown device"} · {formatVenueDateTime(session.lastUsedAt, "UTC")}</span>
              <Button variant="danger" loading={busy === session.id} disabled={busy !== null && busy !== session.id} onClick={() => {
                void run(session.id, async () => {
                  try {
                    await revokeDevice(user.id, session.id);
                    setSuccess("Session revoked.");
                    setAttempt((value) => value + 1);
                  } catch (reason) {
                    setMessage(reason instanceof DashError ? reason.message : "The session could not be revoked.");
                  }
                });
              }}>Revoke</Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

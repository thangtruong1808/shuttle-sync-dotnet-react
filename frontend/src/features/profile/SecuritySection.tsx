import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { LogOut } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Card, PageHeader, Skeleton } from "../../components/ui";
import { EmptyState, ErrorState, formatVenueDateTime } from "../../components/format";
import { externalLogins, providerStartUrl, type ExternalLogin } from "../auth/authApi";
import { fetchSessions, logoutOthers, revokeSession } from "../auth/authSlice";

export function SecuritySection() {
  const dispatch = useDispatch<AppDispatch>();
  const sessions = useSelector((state: RootState) => state.auth.sessions);
  const sessionsStatus = useSelector((state: RootState) => state.auth.sessionsStatus);
  const [logins, setLogins] = useState<ExternalLogin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchSessions());
    externalLogins().then(setLogins).catch(() => setError("Linked accounts could not be loaded."));
  }, [dispatch]);

  return (
    <div className="space-y-8">
      <div>
        <PageHeader title="Security" />
        <Card title="Linked accounts">
        {error ? (
          <div className="mt-3">
            <ErrorState
              message={error}
              loading={pending === "logins"}
              onRetry={() => {
                setPending("logins");
                externalLogins()
                  .then((items) => {
                    setLogins(items);
                    setError(null);
                  })
                  .catch(() => setError("Linked accounts could not be loaded."))
                  .finally(() => setPending((current) => (current === "logins" ? null : current)));
              }}
            />
          </div>
        ) : logins === null ? (
          <div className="mt-3" aria-busy="true"><span className="sr-only">Loading linked accounts</span><Skeleton className="h-12" /></div>
        ) : null}
        {logins && logins.length === 0 ? <p className="mt-2 text-sm text-fg/70">No Google or GitHub account is linked.</p> : null}
        <ul className="mt-3 space-y-2">
          {(logins ?? []).map((login) => (
            <li key={login.provider} className="rounded-xl border border-border bg-inset px-3 py-2 text-sm">
              <span className="font-medium capitalize text-fg">{login.provider}</span>
              <span className="ml-2 break-all text-fg/65">{login.emailAtLink}</span>
            </li>
          ))}
        </ul>
        {logins ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {(["google", "github"] as const)
              .filter((provider) => !logins.some((item) => item.provider.toLowerCase() === provider))
              .map((provider) => (
                <a
                  key={provider}
                  href={providerStartUrl(provider)}
                  className="inline-flex min-h-11 items-center rounded-xl border border-border bg-inset px-3.5 py-2 text-sm font-medium text-fg transition hover:border-brand/50"
                >
                  Connect {provider === "github" ? "GitHub" : "Google"}
                </a>
              ))}
          </div>
        ) : null}
        </Card>
      </div>
      <Card
        title="Devices"
        actions={(
          <Button
            variant="secondary"
            icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            loading={pending === "others"}
            disabled={pending !== null && pending !== "others" && pending !== "logins"}
            onClick={() => {
              setPending("others");
              void dispatch(logoutOthers()).finally(() => setPending(null));
            }}
          >
            Sign out all other devices
          </Button>
        )}
      >
        {sessionsStatus === "loading" ? (
          <div className="mt-3" aria-busy="true"><Skeleton className="h-20" /></div>
        ) : sessions.length === 0 ? (
          <div className="mt-3"><EmptyState title="No active devices" body="Sessions appear after you sign in." /></div>
        ) : (
          <ul className="mt-3 space-y-3">
            {sessions.map((session) => (
              <li key={session.id} className="rounded-2xl border border-border bg-inset px-4 py-3 text-sm">
                <p className="font-medium text-fg">{session.isCurrent ? "This device" : "Other device"}</p>
                <p className="mt-1 break-words text-fg/65">{session.userAgent ?? "Unknown browser"}</p>
                <p className="break-words text-fg/65">{session.ipAddress ?? "Unknown address"} · {formatVenueDateTime(session.lastUsedAt, "Australia/Melbourne")}</p>
                <Button
                  className="mt-3 w-full sm:w-auto"
                  variant="danger"
                  icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                  loading={pending === session.id}
                  disabled={pending !== null && pending !== session.id && pending !== "logins"}
                  onClick={() => {
                    setPending(session.id);
                    void dispatch(revokeSession(session.id)).finally(() => setPending(null));
                  }}
                >
                  Sign out this device
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

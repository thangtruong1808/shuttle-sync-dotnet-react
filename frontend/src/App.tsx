import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import type { RootState } from "./app/store";
import { PageSection, SiteLayout, useVenues } from "./components/layout/SiteLayout";
import { EmptyState, ErrorState } from "./components/format";
import { Skeleton } from "./components/ui";
import AuthPanel from "./features/auth/AuthPanel";
import BookingStubPage from "./features/booking/BookingStubPage";
import CourtsPage from "./features/courts/CourtsPage";
import DashboardLayout from "./features/dashboard/DashboardLayout";
import DashboardPage from "./features/dashboard/DashboardPage";
import { ActivityPage, BookingsPage, PaymentsPage, PromotionsPage, RecommendationsPage, RewardsPage as DashboardRewardsPage } from "./features/dashboard/OpsPages";
import { UserDesk, UsersPage } from "./features/dashboard/UsersDesk";
import VenueDesk from "./features/dashboard/VenueDesk";
import VenuesPage from "./features/dashboard/VenuesPage";
import HomePage from "./features/home/HomePage";
import { CancellationPage, ContactPage, FaqPage, NotFoundPage, PrivacyPage, RewardsPage, TermsPage } from "./features/pages/StaticPages";
import { BookingsSection } from "./features/profile/BookingsSection";
import ProfileLayout from "./features/profile/ProfileLayout";
import { DetailsSection, OverviewSection } from "./features/profile/ProfileBasics";
import { PaymentsSection, RewardsSection, SecuritySection } from "./features/profile/ProfileLists";
import { readVenueSlug } from "./features/venues/venueApi";

function HomeRedirect() {
  const { venues, error, reload } = useVenues();
  const [params] = useSearchParams();
  const authError = params.get("authError");
  if (authError) {
    return <Navigate to={`/login?authError=${encodeURIComponent(authError)}`} replace />;
  }
  if (error) {
    return (
      <PageSection>
        <ErrorState message={error} onRetry={reload} />
      </PageSection>
    );
  }
  if (!venues) {
    return (
      <PageSection>
        <div aria-busy="true">
          <span className="sr-only">Loading venues</span>
          <Skeleton className="h-40" />
        </div>
      </PageSection>
    );
  }
  const remembered = readVenueSlug();
  const slug = venues.find((venue) => venue.slug === remembered)?.slug ?? venues[0]?.slug;
  if (!slug) {
    return (
      <PageSection>
        <EmptyState title="No venues yet" body="Add a venue to the database, then refresh this page." />
      </PageSection>
    );
  }
  return <Navigate to={`/${slug}`} replace />;
}

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const status = useSelector((state: RootState) => state.auth.status);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  useEffect(() => {
    if (status === "authenticated" && !params.get("authError")) {
      navigate(destination ?? "/", { replace: true });
    }
  }, [destination, navigate, params, status]);

  return (
    <main>
      <PageSection>
        <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-pine/90 p-5 sm:p-7">
          <h1 className="font-display text-2xl font-semibold text-white">Your account</h1>
          <p className="mt-1 text-sm text-mist/65">Email, Google, or GitHub. Tokens stay in secure cookies.</p>
          <AuthPanel initialMode={mode} onLoginSuccess={() => navigate(destination ?? "/")} />
        </div>
      </PageSection>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="venues" element={<VenuesPage />} />
          <Route path="venues/:venueId" element={<VenueDesk />} />
          <Route path="venues/:venueId/:section" element={<VenueDesk />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:userId" element={<UserDesk />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="rewards" element={<DashboardRewardsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="recommendations" element={<RecommendationsPage />} />
        </Route>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/cancellation" element={<CancellationPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/profile" element={<ProfileLayout />}>
            <Route index element={<OverviewSection />} />
            <Route path="details" element={<DetailsSection />} />
            <Route path="bookings" element={<BookingsSection />} />
            <Route path="rewards" element={<RewardsSection />} />
            <Route path="payments" element={<PaymentsSection />} />
            <Route path="security" element={<SecuritySection />} />
          </Route>
          <Route path="/:slug" element={<HomePage />} />
          <Route path="/:slug/courts" element={<CourtsPage />} />
          <Route path="/:slug/book/:sessionId" element={<BookingStubPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

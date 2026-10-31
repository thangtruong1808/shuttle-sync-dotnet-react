import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { DocumentTitle } from "./components/DocumentTitle";
import { PageSection, SiteLayout, useVenues } from "./components/layout/SiteLayout";
import { EmptyState, ErrorState } from "./components/format";
import { Skeleton } from "./components/ui";
import AuthPage from "./features/auth/AuthPage";
import BookingStubPage from "./features/booking/BookingStubPage";
import BookCourtPage from "./features/booking/BookCourtPage";
import CourtGroupPage from "./features/booking/CourtGroupPage";
import SocialPage from "./features/booking/SocialPage";
import SocialCheckoutPage from "./features/booking/SocialCheckoutPage";
import SocialPayPage from "./features/booking/SocialPayPage";
import CourtsPage from "./features/courts/CourtsPage";
import DashboardLayout from "./features/dashboard/DashboardLayout";
import DashboardPage from "./features/dashboard/DashboardPage";
import { ActivityPage, BookingsPage, PaymentsPage, PromotionsPage, RewardsPage as DashboardRewardsPage } from "./features/dashboard/OpsPages";
import { RecommendationsPage } from "./features/dashboard/RecommendationsPage";
import { UserDesk, UsersPage } from "./features/dashboard/UsersDesk";
import VenueDesk from "./features/dashboard/VenueDesk";
import VenuesPage from "./features/dashboard/VenuesPage";
import HomePage from "./features/home/HomePage";
import { CancellationPage, ContactPage, FaqPage, NotFoundPage, PrivacyPage, PromotionsPage as PublicPromotionsPage, RewardsPage, TermsPage } from "./features/pages/StaticPages";
import { BookingsSection } from "./features/profile/BookingsSection";
import { FriendSpotsSection } from "./features/profile/FriendSpotsSection";
import ProfileLayout from "./features/profile/ProfileLayout";
import { DetailsSection, OverviewSection } from "./features/profile/ProfileBasics";
import { PaymentsSection, RewardsSection, SecuritySection } from "./features/profile/ProfileLists";
import { RecommendationsSection } from "./features/profile/RecommendationsSection";
import { venueForPage } from "./features/venues/venueApi";
import VenueGate from "./features/venues/VenueGate";

function HomeRedirect() {
  const { venues, error, retrying, reload, defaultSlug } = useVenues();
  const [params] = useSearchParams();
  const authError = params.get("authError");
  if (authError) {
    return <Navigate to={`/login?authError=${encodeURIComponent(authError)}`} replace />;
  }
  if (error) {
    return (
      <PageSection>
        <ErrorState message={error} loading={retrying} onRetry={reload} />
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
  const slug = venueForPage(venues, undefined, defaultSlug)?.slug;
  if (!slug) {
    return (
      <PageSection>
        <EmptyState title="No venues yet" body="Add a venue to the database, then refresh this page." />
      </PageSection>
    );
  }
  return <Navigate to={`/${slug}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <DocumentTitle />
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
          <Route path="/login" element={<AuthPage key="login" mode="login" />} />
          <Route path="/register" element={<AuthPage key="register" mode="register" />} />
          <Route path="/promotions" element={<PublicPromotionsPage />} />
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
            <Route path="friend-spots" element={<FriendSpotsSection />} />
            <Route path="rewards" element={<RewardsSection />} />
            <Route path="payments" element={<PaymentsSection />} />
            <Route path="recommendations" element={<RecommendationsSection />} />
            <Route path="security" element={<SecuritySection />} />
          </Route>
          <Route path="/:slug" element={<VenueGate />}>
            <Route index element={<HomePage />} />
            <Route path="courts" element={<CourtsPage />} />
            <Route path="book" element={<BookCourtPage />} />
            <Route path="book/group/:groupId" element={<CourtGroupPage />} />
            <Route path="book/:sessionId" element={<BookingStubPage />} />
            <Route path="social" element={<SocialPage />} />
            <Route path="social/checkout" element={<SocialCheckoutPage />} />
            <Route path="social/:socialId" element={<SocialPayPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

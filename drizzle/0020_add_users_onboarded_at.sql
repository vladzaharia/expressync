-- Polaris Track A: track customer onboarding completion
--
-- Nullable timestamp flipped by `POST /api/customer/onboarded` after the
-- first-run dashboard tour completes. Used to gate the OnboardingTour
-- overlay so returning customers don't see it. Admins are unaffected — they
-- never visit the onboarding flow.

ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamptz;

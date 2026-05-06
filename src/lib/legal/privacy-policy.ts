import type { LegalCard, LegalDocumentMeta } from "./types.ts";

export const PRIVACY_META: LegalDocumentMeta = {
  title: "Privacy Policy",
  description: "How we use your data — in plain English.",
  effectiveDate: "2026-05-06",
  contactEmail: "accounts@vlad.gg",
};

export const PRIVACY_CARDS: LegalCard[] = [
  {
    id: "at-a-glance",
    icon: "Shield",
    title: "At a Glance",
    summary:
      "We collect what we need to charge your EV and bill you for it — nothing more, and we don't sell your data.",
    body:
      "ExpressCharge is operated by Polaris Express (“we,” “us”). This policy explains what personal data we collect when you use example.com, the ExpressCharge iOS app, or charge at our stations, and what rights you have over that data. We do not sell your personal information, we do not share it for cross-context behavioral advertising, and we do not use third-party analytics or advertising trackers.",
    bullets: [
      "Effective date: 2026-05-06",
      "Controller: Polaris Express",
      "Data protection contact: accounts@vlad.gg",
    ],
  },
  {
    id: "who-this-applies-to",
    icon: "Users",
    title: "Who This Covers",
    summary:
      "This covers customers using our website, app, and charging stations — not employees or admins.",
    body:
      "This policy applies to end users of the ExpressCharge service: people who hold a charging card, reserve a charger, or sign in to example.com. Administrators sign in via a separate identity provider governed by an internal access policy. ExpressCharge is not directed at children under 13 (COPPA) or users under 16 (GDPR Art. 8); if we learn we have inadvertently collected data from such a user, we will delete it.",
  },
  {
    id: "account-data",
    icon: "MailOpen",
    title: "Your Account",
    summary:
      "We need your email to sign you in; name and avatar are optional.",
    body:
      "When you create an account we store your email address, your role (customer or admin), and a link to your billing record in Lago (our billing processor). You may optionally add a display name and an avatar URL. We set a session cookie called `ev_billing_session` on the `.example.com` domain so you stay signed in; it is strictly necessary for the service to function.",
    bullets: [
      "Legal basis (GDPR): performance of a contract (Art. 6(1)(b))",
      "Retention: for the life of your account, plus the periods below",
    ],
  },
  {
    id: "sign-in-magic-link",
    icon: "FileLock",
    title: "How Sign-In Works",
    summary:
      "We email you a one-time link; we hash your email in our logs and only keep request metadata for 30 days.",
    body:
      "We use passwordless “magic-link” sign-in. Your email is sent through a Cloudflare Email Worker (HMAC-signed for integrity) solely to deliver the link. In our audit logs your email is stored only as a SHA-256 hash — never in cleartext. When you request or consume a magic link, we record your IP address and User-Agent for fraud prevention and keep that record for 30 days. Authentication events more broadly are kept for 90 days.",
    bullets: [
      "Magic-link audit log: 30 days",
      "General auth audit log: 90 days",
      "Legal basis (GDPR): legitimate interest in account security (Art. 6(1)(f))",
    ],
  },
  {
    id: "charging-activity",
    icon: "Zap",
    title: "Charging Sessions",
    summary:
      "When you tap your card to charge, we record the session so we can bill you accurately.",
    body:
      "Each charging session is associated with your card's RFID UID (the OCPP `idTag`). We record the charger ID, connector, session start and end times, and kilowatt-hours delivered. These usage events are forwarded to Lago to calculate your bill. The charger's physical location is the operator's data, not derived from you — we do not collect your device's location.",
    bullets: [
      "Legal basis (GDPR): performance of a contract (Art. 6(1)(b))",
      "Retention: as long as needed for billing, dispute resolution, and tax/accounting obligations",
    ],
  },
  {
    id: "reservations",
    icon: "CalendarClock",
    title: "Reservations",
    summary:
      "When you reserve a charger, we store the charger, time window, and which card you'll use.",
    body:
      "A reservation record contains the charger and connector you've reserved, the time window, and the RFID card you intend to use. We retain reservations for operational and audit purposes alongside related session records.",
  },
  {
    id: "ios-companion-app",
    icon: "Smartphone",
    title: "The iOS App",
    summary:
      "The app is a stateless NFC reader — it sends device health to us so we know it's working, and it stores nothing about your charging on your phone.",
    body:
      "The ExpressCharge iOS app is a thin client. It does not persist scan history, billing data, or session data on your device. Your sign-in credentials are stored in the iOS Keychain. While the app is open, it sends a heartbeat (~every 60 seconds) so we can confirm the device is healthy and reachable for push notifications.",
    bullets: [
      "Heartbeat payload: device label (a name you choose), iPhone model, iOS version, app version, APNs push token, locale, timezone, battery level and state, thermal state, free disk space, NFC permission status, push permission status, last-seen timestamp",
      "Not collected: scan history on-device, location, contacts, photos, advertising identifier",
      "Apple privacy: data linked to your identity; we do not “track” you in the App Store sense",
    ],
  },
  {
    id: "processors",
    icon: "Database",
    title: "Who Processes Your Data",
    summary:
      "We use a small, named set of vendors — each one only sees what they need to do their job.",
    body:
      "We rely on the following sub-processors, each bound by a data processing agreement and limited to the purposes shown:",
    bullets: [
      "Apple (APNs) — delivering push notifications to your iPhone",
      "Lago — billing; receives usage events, customer ID, and subscription metadata",
      "SteVe / OCPP backend — charge session data and RFID tag metadata",
      "Cloudflare Email Worker — sending transactional sign-in emails (your email passes through but is not stored long-term by us in cleartext)",
      "Pocket ID — admin SSO only; not used by customers",
    ],
  },
  {
    id: "what-we-dont-do",
    icon: "Ban",
    title: "What We Don't Do",
    summary:
      "No analytics, no ad trackers, no selling, no location tracking.",
    body:
      "We do not use Google Analytics, Sentry, advertising SDKs, or any third-party tracking. We do not collect device location beyond what is implicit in a charging session at a known charger. We do not sell your personal information, and we do not “share” it for cross-context behavioral advertising as those terms are defined under the California Consumer Privacy Act (CCPA/CPRA).",
  },
  {
    id: "international-transfers",
    icon: "Globe",
    title: "International Transfers",
    summary:
      "Our infrastructure is US-based; if you're in the EU/UK, your data will travel to the US under standard contractual safeguards.",
    body:
      "ExpressCharge is operated from the United States. If you access the service from the European Economic Area, the United Kingdom, or Switzerland, your personal data will be transferred to and processed in the US. Where required, we rely on the European Commission's Standard Contractual Clauses (and the UK Addendum) with our sub-processors as the legal mechanism for transfer.",
  },
  {
    id: "your-rights-eu",
    icon: "Scale",
    title: "Your Rights (EU/UK)",
    summary:
      "You can ask to see, fix, export, or delete your data — and we'll respond within a month.",
    body:
      "If GDPR or UK GDPR applies to you, you have the rights below. To exercise any of them, email accounts@vlad.gg from the address on your account; we'll respond within 30 days. You also have the right to lodge a complaint with your local supervisory authority.",
    bullets: [
      "Access — get a copy of what we hold",
      "Rectification — correct inaccurate data",
      "Erasure (“right to be forgotten”)",
      "Portability — receive your data in a machine-readable format",
      "Restriction — pause our processing",
      "Objection — object to processing based on legitimate interest",
      "Withdraw consent — where processing is consent-based",
    ],
  },
  {
    id: "your-rights-california",
    icon: "BadgeCheck",
    title: "Your Rights (California)",
    summary:
      "California residents have the right to know, delete, correct, and opt out — and we won't penalize you for using them.",
    body:
      "If you are a California resident, the CCPA/CPRA gives you the rights listed below. Because we do not sell or share personal information and we do not use sensitive personal information for inferring characteristics, the “opt-out of sale,” “opt-out of sharing,” and “limit use of sensitive PI” rights do not change anything in practice — but you have them, and you can exercise them at accounts@vlad.gg. We will not discriminate against you for exercising any privacy right.",
    bullets: [
      "Right to know what we collect and why",
      "Right to delete",
      "Right to correct",
      "Right to opt out of sale (we don't sell)",
      "Right to opt out of sharing for cross-context advertising (we don't share)",
      "Right to limit use of sensitive personal information",
      "Right to non-discrimination",
    ],
  },
  {
    id: "security-retention-changes",
    icon: "Bell",
    title: "Security, Retention & Changes",
    summary:
      "We protect data in transit and at rest, keep it only as long as needed, and will tell you if this policy changes.",
    body:
      "We use TLS in transit, encryption at rest where supported by our infrastructure, hashed identifiers in logs, and least-privilege access controls. Retention periods are shown on the relevant cards above; account data is kept for the life of your account and deleted (or anonymized for legal/accounting reasons) on closure. If we materially change this policy we'll notify you in the app and by email at least 14 days before the change takes effect. Questions or requests: accounts@vlad.gg.",
  },
];

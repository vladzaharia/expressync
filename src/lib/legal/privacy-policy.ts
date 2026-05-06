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
      "When you create an account we store your email address, your role (customer or admin), and a link to your billing record. You may optionally add a display name and an avatar URL. We set a session cookie called `ev_billing_session` on the `.example.com` domain so you stay signed in; it is strictly necessary for the service to function.",
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
      "We use passwordless “magic-link” sign-in. Your email passes through Cloudflare's email-delivery network solely to send you the link — it is not retained there once delivered. In our own audit logs your email is stored only as a SHA-256 hash, never in cleartext. When you request or consume a magic link, we record your IP address and User-Agent for fraud prevention and keep that record for 30 days. Authentication events more broadly are kept for 90 days.",
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
      "Each charging session is associated with your card's RFID UID. We record the charger ID, connector, session start and end times, and kilowatt-hours delivered. These usage events feed into our own billing system to calculate your invoice. The charger's physical location is part of the station's setup, not derived from you — we do not collect your device's location.",
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
    title: "Where Your Data Lives",
    summary:
      "Almost everything stays on our own infrastructure. Two outside services touch a narrow slice of it to do specific jobs.",
    body:
      "Your account, charging history, billing records, and device data live on servers we operate. We run our own billing system, our own charging-station network controller, and our own database. None of that is shared with a third-party SaaS vendor. Two external services handle tasks we can't do alone:",
    bullets: [
      "Apple Push Notification service — delivers a notification to your iPhone (e.g., to confirm a tap-to-start session). Apple sees the push token and the notification content; they do not retain it once delivered.",
      "Cloudflare email delivery — relays your magic-link sign-in email. The message passes through their network in transit; they don't store the body once delivered.",
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
      "We operate from the United States; outside services may briefly handle your data wherever they're located.",
    body:
      "ExpressCharge is operated from the United States. If you access the service from outside the US, your personal data will be transferred to and processed there. The two outside services we rely on (Apple Push Notifications and Cloudflare email delivery) operate globally; where required, we rely on the European Commission's Standard Contractual Clauses (and the UK Addendum) with them as the legal mechanism for transfer.",
  },
  {
    id: "your-rights",
    icon: "Scale",
    title: "Your Rights",
    summary:
      "You can ask to see, fix, export, or delete your data — and we extend these rights to everyone, not just where the law requires.",
    body:
      "Privacy laws like GDPR (EU/UK) and CCPA/CPRA (California) require us to give residents specific rights over their data. Rather than maintain two sets of rules, we offer the same rights to every customer, anywhere in the world. Email accounts@vlad.gg from the address on your account; we'll respond within 30 days. We won't penalize you for using any of these rights.",
    bullets: [
      "Know — see what we hold about you and how we use it",
      "Correct — fix anything that's wrong",
      "Delete — close your account; we erase what we can and anonymize what we must keep for legal or accounting reasons",
      "Export — receive your data in a machine-readable format",
      "Restrict — pause our processing of your data",
      "Object — challenge processing we base on legitimate interest",
      "Withdraw consent — for anything we asked your consent for",
      "Complain — EU/UK residents may also lodge a complaint with their local supervisory authority",
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

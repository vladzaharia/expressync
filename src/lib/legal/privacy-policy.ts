import type { LegalCard, LegalDocumentMeta } from "./types.ts";

export const PRIVACY_META: LegalDocumentMeta = {
  title: "Privacy Policy",
  effectiveDate: "2026-05-10",
  contactEmail: "privacy@example.com",
};

/**
 * Card to render with extra emphasis at the top of the stack — same
 * accent treatment the Terms agreement-gate gets. "At a Glance" is the
 * one-paragraph summary of the policy and earns the visual weight.
 */
export const PRIVACY_GATE_ID = "at-a-glance";

export const PRIVACY_CARDS: LegalCard[] = [
  {
    id: "at-a-glance",
    icon: "Shield",
    title: "At a Glance",
    summary:
      "We collect what we need to charge your EV and bill you. Nothing more. We don't sell your data.",
    body:
      "ExpressCharge is built and run by Polaris Express. This policy covers what data we collect when you use example.com, the ExpressCharge iOS app, or charge at one of our stations — and what you can do about it.\n\nWe don't sell your data. We don't hand it to advertisers. We don't run third-party analytics or trackers.",
  },
  {
    id: "who-this-applies-to",
    icon: "Users",
    title: "Who This Covers",
    summary: "Customers using our website, app, or charging stations.",
    body:
      "This policy is for customers — anyone who holds a charging card, reserves a charger, or signs in to example.com. Polaris team members and admins sign in through a separate system with its own access policy.\n\nExpressCharge isn't built for kids. We don't intentionally collect data from anyone under 16, and if we find out we did, we'll delete it.",
  },
  {
    id: "account-data",
    icon: "MailOpen",
    title: "Your Account",
    summary: "Your email signs you in. Name and avatar are optional.",
    body:
      "When you create an account, we keep your email address and your role on the service. You can add a display name and an avatar URL if you want.\n\nWe also set a session cookie on example.com so you stay signed in. Without it the service can't recognize you between page loads. We hold onto your account data for as long as your account is open.",
  },
  {
    id: "sign-in-magic-link",
    icon: "FileLock",
    title: "How Sign-In Works",
    summary:
      "We email you a one-time link. Your address is hashed in our logs and request metadata is kept for 30 days.",
    body:
      "Sign-in is passwordless. You enter your email, we email you a one-time link, and clicking it signs you in. The email passes through Cloudflare's mail-delivery network on the way to your inbox; nothing is retained there once the message is sent.\n\nIn our own logs, your email address shows up only as an irreversible hash — never in plain text. We do log the IP address and browser identifier of each sign-in request and click, so we can spot fraud or replay attacks. That fraud-prevention log lives for 30 days. Other sign-in events (successful logins, token issuance) are kept for 90 days.",
  },
  {
    id: "charging-activity",
    icon: "Zap",
    title: "Charging Sessions",
    summary:
      "When you charge — at a station or remotely from the app — we record the session so we can bill you accurately.",
    body:
      "However the session starts (a tap of your charging card at the station, or a remote start from the app), we tie it to your registered card and account. We record which station and connector you used, when the session started and ended, and how many kilowatt-hours flowed.\n\nThose numbers feed our billing system to produce your invoice. The station's location is part of the station's setup — we don't derive it from your phone, and we don't collect your device's location. We hold session records as long as we need them for billing, disputes, and tax or accounting rules.",
  },
  {
    id: "reservations",
    icon: "CalendarClock",
    title: "Reservations",
    summary:
      "When you reserve a charger, we hold the station, time, and which card you'll tap.",
    body:
      "A reservation record contains the station and connector you've booked, the time window, and which of your cards you'll tap when you arrive. We hold reservation records for the same period as the related session record, so the two can be reconciled later if a question comes up.",
  },
  {
    id: "ios-companion-app",
    icon: "Smartphone",
    title: "The iOS App",
    summary:
      "The app is for managing your charging — starting sessions, watching them, and reviewing your account. Nothing about your charging is stored on your phone.",
    body:
      "The ExpressCharge iOS app is a lightweight client. You can use it to start a charging session remotely, watch a session in real time, and review your usage and account details. The data you see comes from our servers — your charging history, billing details, and session records all live there, not on your phone.\n\nThe only thing the app stores on your device is your sign-in credential, in the iOS Keychain. While the app is open, it sends us a short status update about once a minute so we know it's online and reachable for push notifications.\n\nIf you grant location access, the app uses your approximate location to sort the chargers list with the closest one first. The location stays on your phone — we never receive or store it.",
    bullets: [
      "What's in the status update for customer accounts: the name you gave the device, iPhone model and iOS version, the app version, the push-notification token Apple gives the app, your locale and timezone, NFC and notification permission states, and a last-seen timestamp",
      "Customer-account devices do not send us battery level, thermal state, or free disk space. Polaris-team devices, which we use to manage the network, do continue to report those values so we can keep the fleet healthy.",
      "Approximate location, while the app is open, is used only to order chargers by distance — not stored on our servers",
      "What we don't collect: contacts, photos, microphone, camera, advertising identifier, or any on-device session history",
      "What we tell Apple: this data is linked to your account, but we don't use it to track you across other apps or websites",
    ],
  },
  {
    id: "diagnostic-logs",
    icon: "ClipboardList",
    title: "Diagnostic Logs",
    summary:
      "The iOS app keeps a short log of internal events to help us debug problems, and uploads it with the regular sync. Personal details are removed before anything is written down.",
    body:
      'The ExpressCharge iOS app records a structured log of internal events — things like "sync completed", "charger list refreshed", or "NFC scan failed" — plus the relevant code path, severity, and timestamp. That log rides on the same once-a-minute status update we already send. We use it to trace bugs that the app can\'t tell us about by itself.\n\nBefore the app writes anything to disk OR sends it to us, it runs the message through a redaction pass that strips email addresses, phone numbers, login tokens, and card identifiers. The redaction is local to your phone and applies before the entry ever leaves your device.\n\nWhat we keep on the server is bounded: 7 days, then it\'s automatically deleted. Only Polaris admins (not other customers) can read your device\'s logs through our admin tools. The buffer on your phone is bounded too — about 5 MB, oldest entries dropped first — and is wiped when you sign out.',
    bullets: [
      'What\'s in a log entry: severity (debug / info / warn / error), category (e.g. "network" or "scan"), the redacted message, ISO-8601 timestamp, app version, OS version, and your device id',
      "What's redacted on-device before logging: email addresses, JWTs, bearer tokens, attribute keys starting with `card_`, `Authorization` headers, E.164 phone numbers",
      "Server retention: 7 days, deleted automatically by a scheduled job",
      "Who can read it: Polaris admins via our internal admin tools — never other customers, never third parties, never advertisers",
      "On-device retention: ~5 MB ring buffer; oldest entries drop when full; entire buffer wiped on sign-out",
    ],
  },
  {
    id: "processors",
    icon: "Database",
    title: "Where Your Data Lives",
    summary:
      "Almost everything stays on our own servers. Two outside services touch a narrow slice to do specific jobs.",
    body:
      "We run our own billing system, our own charging-station network controller, and our own database. Your account, charging history, billing records, and device data all live there — not in someone else's cloud product.\n\nTwo outside services handle tasks we can't do ourselves:",
    bullets: [
      "Apple Push Notifications — when we need to ping your iPhone (for example, to confirm a tap-to-start session), the notification travels through Apple's network. Apple sees the push token and content during delivery, and doesn't retain either afterward.",
      "Cloudflare mail delivery — when you sign in, your one-time link email travels through Cloudflare's mail network on the way to your inbox. The message passes through in transit; nothing is stored after delivery.",
    ],
  },
  {
    id: "what-we-dont-do",
    icon: "Ban",
    title: "What We Don't Do",
    summary:
      "No analytics. No ad trackers. No selling. No location tracking on our servers.",
    body:
      "We don't run third-party analytics, error-tracking, or advertising SDKs. We don't store your location on our servers — when you grant the iOS app location access, your phone uses it locally to sort the chargers list, and that's it. The only station-side location implied by your account is whichever charger you actually used. We don't sell your data, and we don't trade it with advertisers for cross-app or cross-site profiling.",
  },
  {
    id: "international-transfers",
    icon: "Globe",
    title: "International Transfers",
    summary:
      "We're based in the US. Outside services may briefly handle your data wherever they're located.",
    body:
      "We run ExpressCharge from the United States, and your data is processed on our US servers. The two outside services we rely on (Apple Push Notifications and Cloudflare mail delivery) operate globally and may briefly handle your data wherever they're located. Where European law calls for it, we use Standard Contractual Clauses with those services so the transfer is legally protected.",
  },
  {
    id: "your-rights",
    icon: "Scale",
    title: "Your Rights",
    summary:
      "You can see, fix, export, or delete your data — and we extend these rights to everyone, not just where the law requires it.",
    body:
      "Every customer has the same rights over their data, no matter where you live. To use any of them, email privacy@example.com from the address on your account. We'll respond within 30 days. We won't make the service worse for you because you asked.",
    bullets: [
      "Know — see what we hold and what we do with it",
      "Correct — fix anything that's wrong",
      "Delete — close your account; we erase what we can and anonymize what we can't",
      "Export — receive your data in a machine-readable format",
      "Restrict — ask us to pause our use of your data",
      "Object — push back on a use you didn't actively agree to (for example, fraud-prevention logging)",
      "Withdraw consent — take back any permission you've given us",
    ],
  },
  {
    id: "security-retention-changes",
    icon: "Bell",
    title: "Security, Retention & Changes",
    summary:
      "We protect data on the wire and at rest, keep it only as long as needed, and tell you before this policy changes.",
    body:
      "We encrypt data on the wire (HTTPS / TLS) and at rest wherever the storage supports it. Identifiers in our logs are stored as one-way hashes rather than plain text. Access on our team is limited to who actually needs it.\n\nRetention periods are listed on the relevant cards above. Account data sticks around as long as your account does — we erase it on closure, except where we're required to keep something for legal or accounting reasons (in which case we anonymize what we can).\n\nIf we make a meaningful change to this policy, we'll tell you in the app and by email at least 14 days before it takes effect.",
  },
];

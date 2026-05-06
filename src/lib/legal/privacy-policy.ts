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
      "ExpressCharge is operated by Polaris Express (“we,” “us”). This policy explains what personal data we collect when you use example.com, the ExpressCharge iOS app, or charge at our stations — and what rights you have over that data. We don't sell your personal information, we don't trade it with advertisers, and we don't run third-party analytics or trackers.",
    bullets: [
      "Effective date: 2026-05-06",
      "Operator: Polaris Express",
      "Privacy contact: accounts@vlad.gg",
    ],
  },
  {
    id: "who-this-applies-to",
    icon: "Users",
    title: "Who This Covers",
    summary:
      "This covers customers using our website, app, and charging stations — not employees or admins.",
    body:
      "This policy applies to people who use ExpressCharge to charge their vehicle: anyone holding a charging card, reserving a charger, or signing in to example.com. Administrators sign in through a separate system governed by an internal access policy. ExpressCharge isn't aimed at children under 13 (US COPPA) or users under 16 (EU GDPR), and if we discover we've collected data from someone in that age range, we'll delete it.",
  },
  {
    id: "account-data",
    icon: "MailOpen",
    title: "Your Account",
    summary:
      "We need your email to sign you in; name and avatar are optional.",
    body:
      "When you create an account, we store your email address, your role (customer or admin), and a link to your billing record. You can optionally add a display name and an avatar URL. We also set a session cookie on example.com so you stay signed in — without it the service can't recognize you between page loads.",
    bullets: [
      "Why we're allowed to (GDPR): we need it to provide the service you signed up for",
      "How long we keep it: for the life of your account",
    ],
  },
  {
    id: "sign-in-magic-link",
    icon: "FileLock",
    title: "How Sign-In Works",
    summary:
      "We email you a one-time link; we hash your email in our logs and only keep request metadata for 30 days.",
    body:
      "Sign-in is passwordless. You enter your email, we email you a one-time link, and clicking it signs you in. The email itself passes through Cloudflare's mail-delivery network on the way to your inbox; nothing is retained there after the message is sent. In our own logs, your email address is stored only as an irreversible hash — never in plain text. We do record the IP address and browser identifier of each sign-in request and the click that consumes it, so we can spot fraud or replay attacks; that record is kept for 30 days. Other sign-in events (successful logins, token issuance, etc.) are kept for 90 days.",
    bullets: [
      "Sign-in fraud log: 30 days",
      "General sign-in log: 90 days",
      "Why we're allowed to (GDPR): we have a legitimate interest in keeping accounts secure",
    ],
  },
  {
    id: "charging-activity",
    icon: "Zap",
    title: "Charging Sessions",
    summary:
      "When you tap your card to charge, we record the session so we can bill you accurately.",
    body:
      "Every charging session is tied to the unique number on your card's RFID chip. We record which station and connector you used, when the session started and ended, and how many kilowatt-hours were delivered. Those numbers feed our billing system, which produces your invoice. The station's physical location is part of the station's own setup — it isn't derived from your phone, and we don't collect your device's location.",
    bullets: [
      "Why we're allowed to (GDPR): we need it to provide the charging you signed up for",
      "How long we keep it: as long as needed for billing, disputes, and tax / accounting rules",
    ],
  },
  {
    id: "reservations",
    icon: "CalendarClock",
    title: "Reservations",
    summary:
      "When you reserve a charger, we store the charger, time window, and which card you'll use.",
    body:
      "A reservation record holds the station and connector you've booked, the time window you booked it for, and which of your cards you'll tap when you arrive. We keep reservation records for the same period as the related charging session record so the two can be reconciled if a question comes up later.",
  },
  {
    id: "ios-companion-app",
    icon: "Smartphone",
    title: "The iOS App",
    summary:
      "The app reads your card and shows you the screen, but doesn't keep any charging history on your phone.",
    body:
      "The ExpressCharge iOS app is a lightweight client. Your scan history, billing details, and charging sessions all live on our servers, not on your phone. The only thing the app stores locally is your sign-in credential, which lives in the iOS Keychain. While the app is open, it sends us a short status update about once a minute so we know it's online and reachable for push notifications.",
    bullets: [
      "What's in the status update: the name you gave the device, iPhone model and iOS version, the app's version, the push notification token Apple gives the app, your locale and timezone, battery level and state, thermal state, free disk space, whether NFC and notification permissions are granted, and a last-seen timestamp",
      "What we don't collect: location, contacts, photos, microphone, camera roll, advertising identifier, or any on-device scan history",
      "What we tell Apple: the data we collect is linked to your account, but we don't use it to track you across other apps or websites",
    ],
  },
  {
    id: "processors",
    icon: "Database",
    title: "Where Your Data Lives",
    summary:
      "Almost everything stays on our own infrastructure. Two outside services touch a narrow slice of it to do specific jobs.",
    body:
      "Your account, your charging history, your billing records, and your device data all live on servers we run ourselves. We host our own billing system, our own charging-station network controller, and our own database — none of that is handed off to anyone else's cloud product. Two outside services handle tasks we can't do on our own:",
    bullets: [
      "Apple Push Notifications — when we need to ping your iPhone (for example, to confirm a tap-to-start session), we send the notification through Apple's network. Apple sees the push token and the notification content during delivery and doesn't retain either afterward.",
      "Cloudflare mail delivery — when you sign in, your one-time link email travels through Cloudflare's mail network on the way to your inbox. The message passes through in transit; it isn't stored after it's delivered.",
    ],
  },
  {
    id: "what-we-dont-do",
    icon: "Ban",
    title: "What We Don't Do",
    summary:
      "No analytics, no ad trackers, no selling, no location tracking.",
    body:
      "We don't use third-party analytics, error-tracking, or advertising SDKs. We don't collect your device's location — the only location implicit in your data is whichever station you actually charged at. We don't sell your personal information, and we don't trade it with advertisers for cross-app or cross-site profiling.",
  },
  {
    id: "international-transfers",
    icon: "Globe",
    title: "International Transfers",
    summary:
      "We operate from the United States; outside services may briefly handle your data wherever they're located.",
    body:
      "We operate ExpressCharge from the United States. If you use the service from outside the US, your data travels to our US servers to be processed. The two outside services we rely on (Apple Push Notifications and Cloudflare mail delivery) operate globally and may briefly handle your data wherever they're located. Where European law requires it, we rely on the European Commission's Standard Contractual Clauses (and the UK Addendum) as the legal basis for those transfers.",
  },
  {
    id: "your-rights",
    icon: "Scale",
    title: "Your Rights",
    summary:
      "You can ask to see, fix, export, or delete your data — and we extend these rights to everyone, not just where the law requires.",
    body:
      "Privacy laws like GDPR in Europe and CCPA in California give residents specific rights over their data. Rather than running two sets of rules, we offer the same rights to every customer, wherever you live. To use any of them, email accounts@vlad.gg from the address on your account — we'll respond within 30 days. We won't make the service harder for you because you asked.",
    bullets: [
      "Know — see what we hold about you and what we do with it",
      "Correct — fix anything that's wrong",
      "Delete — close your account; we erase what we can and anonymize anything we have to keep for legal or accounting reasons",
      "Export — receive your data in a machine-readable format",
      "Restrict — ask us to pause our use of your data",
      "Object — push back on a use we justify by “legitimate interest” (essentially, where we say the service needs it but you didn't actively agree to it)",
      "Withdraw consent — take back any permission you previously gave us",
      "Complain — if you live in the EU or UK, you can also raise a complaint with your local data-protection regulator",
    ],
  },
  {
    id: "security-retention-changes",
    icon: "Bell",
    title: "Security, Retention & Changes",
    summary:
      "We protect data in transit and at rest, keep it only as long as needed, and will tell you if this policy changes.",
    body:
      "We encrypt data on the wire (HTTPS / TLS) and on disk wherever the underlying storage supports it, log identifiers as one-way hashes rather than plain text, and limit who on our team can access what. Retention periods are shown on the relevant cards above; account data is kept for the life of your account and is erased — or anonymized when we have to keep something for legal or accounting reasons — when you close your account. If we make a meaningful change to this policy we'll tell you in the app and by email at least 14 days before it takes effect. Questions or data requests: accounts@vlad.gg.",
  },
];

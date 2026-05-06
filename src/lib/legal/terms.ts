import type { LegalCard, LegalDocumentMeta } from "./types.ts";

export const TERMS_META: LegalDocumentMeta = {
  title: "Terms of Service",
  description:
    "The contract between you and Polaris Express — written for humans.",
  effectiveDate: "2026-05-06",
  contactEmail: "accounts@vlad.gg",
};

/**
 * The first card is the "agreement gate" — rendered visually distinct from
 * the rest because reading it is the act that binds the agreement. Routes
 * pull it out of the array and render it on top with a heavier accent.
 */
export const TERMS_GATE_ID = "agreement-gate";

export const TERMS_CARDS: LegalCard[] = [
  {
    id: TERMS_GATE_ID,
    icon: "FileSignature",
    title: "What You're Agreeing To",
    summary:
      "By creating an account or using ExpressCharge, you're entering a contract with Polaris Express on these terms.",
    body:
      "These Terms form a binding agreement between you and Polaris Express (“we,” “us”). They cover your use of example.com, the ExpressCharge iOS app, your charging card, and any charging session at our stations. If you don't agree, don't use the service. You must be at least 18 years old and able to enter into a contract under the law of your jurisdiction.",
  },
  {
    id: "your-account",
    icon: "UserCheck",
    title: "Your Account",
    summary: "Keep your information accurate and your sign-in to yourself.",
    body:
      "You're responsible for keeping the email and any profile information on your account accurate, and for everything that happens under your account. Don't share your sign-in or use someone else's account or charging card. Tell us promptly at accounts@vlad.gg if you suspect unauthorized access.",
  },
  {
    id: "the-service",
    icon: "Zap",
    title: "The Service",
    summary: "ExpressCharge lets you tap to start charging at Polaris EV stations.",
    body:
      "ExpressCharge consists of (a) the example.com website, (b) the iOS companion app, which acts as a stateless NFC reader, and (c) the back-end systems that authorize and meter charging sessions at Polaris-operated EV charging stations. The iOS app is a convenience client; the server is always the source of truth for sessions, balances, and reservations.",
  },
  {
    id: "acceptable-use",
    icon: "ShieldAlert",
    title: "Acceptable Use",
    summary: "Use the app and stations the way they're meant to be used.",
    body:
      "We grant you a limited, non-exclusive, non-transferable, revocable license to use the iOS app and the website for the ordinary purpose of charging your vehicle. You agree not to:",
    bullets: [
      "reverse engineer, decompile, or attempt to extract source code from the app",
      "scrape, automate, or otherwise abuse the service or its APIs",
      "interfere with charging sessions, reservations, or other users",
      "use any card or account that isn't yours",
      "use the service in violation of law or to harm others or our equipment",
    ],
  },
  {
    id: "fees-and-billing",
    icon: "CreditCard",
    title: "Fees & Billing",
    summary:
      "You pay per kWh through Lago; your first charging card is free, additional cards are $3 each.",
    body:
      "Charging fees are usage-based and metered per kilowatt-hour delivered, calculated and invoiced through our billing processor, Lago. Posted rates may vary by station and time and will be shown to you before you start a session where required. Card issuance is free for your first card; additional or replacement cards are $3 each. Subscription plans, if you opt into one, are billed on the cadence shown at sign-up and renew until cancelled. Taxes are added where applicable. Disputes about a charge must be raised within 60 days of the invoice date.",
  },
  {
    id: "reservations-cancellations",
    icon: "CalendarClock",
    title: "Reservations & Cancellations",
    summary:
      "You can reserve a charger and connector for a time window; cancel through the app.",
    body:
      "Reservations hold a specific charger and connector for the time window you select, tied to a specific charging card. You can cancel through the app or website up to the start of the window. Reservations that go unused, or that exceed the reserved window, may incur a hold or no-show fee as posted at the time of booking.",
  },
  {
    id: "safety-equipment",
    icon: "AlertTriangle",
    title: "Safety & Equipment",
    summary:
      "The stations belong to the operator; follow on-site instructions and don't damage them.",
    body:
      "Charging stations are owned and maintained by the operator. You agree to follow all on-site signage, safety instructions, and applicable law when using a station, and to use only equipment in good condition with a vehicle compatible with the connector. You're responsible for damage you cause through misuse, negligence, or unauthorized modification of equipment.",
  },
  {
    id: "disclaimers-liability",
    icon: "ScrollText",
    title: "Disclaimers & Liability",
    summary:
      "We provide the service “as is” and our total liability is capped at what you paid us in the last 12 months.",
    body:
      "To the maximum extent permitted by law, the service is provided “as is” and “as available,” without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We don't guarantee that any particular charger will be available, that charging speeds will meet a specific target, or that the service will be uninterrupted. Our total aggregate liability to you for any claim arising out of or relating to the service is limited to the greater of (a) the fees you paid us in the 12 months before the event giving rise to the claim or (b) USD $100. Nothing in these Terms limits liability that cannot be limited by law (for example, gross negligence, willful misconduct, or — for EU consumers — statutory consumer rights).",
  },
  {
    id: "indemnity",
    icon: "Handshake",
    title: "Mutual Indemnity",
    summary:
      "Each side covers the other for losses caused by its own misuse or breach.",
    body:
      "You'll indemnify us against third-party claims arising from your misuse of the service, your breach of these Terms, or your violation of law. We'll indemnify you against third-party claims that the service, used as permitted, infringes that third party's intellectual property rights. The indemnified party must give prompt notice and reasonable cooperation; the indemnifying party controls the defense and any settlement that fully releases the indemnified party.",
  },
  {
    id: "termination",
    icon: "Trash2",
    title: "Termination",
    summary:
      "Either of us can end this with reasonable notice; your data is handled per the Privacy Policy.",
    body:
      "You can close your account at any time through the app, the website, or by emailing accounts@vlad.gg. We may suspend or terminate your access on reasonable notice — or immediately for material breach, suspected fraud, or safety reasons. On termination, outstanding fees remain payable, and your data is retained, deleted, or anonymized as described in the Privacy Policy.",
  },
  {
    id: "law-and-disputes",
    icon: "Gavel",
    title: "Governing Law & Disputes",
    summary:
      "Washington State law applies; we try to resolve disputes informally first, then through individual arbitration.",
    body:
      "These Terms are governed by the laws of the State of Washington, USA, without regard to its conflict-of-laws rules. Before filing a formal dispute, you agree to contact us at accounts@vlad.gg and give us 30 days to resolve it. If we can't, any unresolved dispute will be resolved by binding individual arbitration seated in King County, Washington, under the rules of a recognized arbitral body (e.g., AAA Consumer Rules), and you and we each waive the right to participate in a class action or class arbitration. Either party may still bring a small-claims case or seek injunctive relief in court for IP misuse. If you are an EU/UK consumer, this clause applies only to the extent permitted by your local law, and you retain the right to bring proceedings in the courts of your country of residence.",
  },
  {
    id: "changes-and-contact",
    icon: "Bell",
    title: "Changes & Contact",
    summary:
      "We'll tell you before we change these Terms; reach us anytime at accounts@vlad.gg.",
    body:
      "We may update these Terms from time to time. For material changes we'll notify you in the app and by email at least 14 days before the change takes effect; continued use after the effective date means you accept the updated Terms. If you don't, you can close your account before the effective date. These Terms, together with the Privacy Policy, are the entire agreement between you and Polaris Express on this subject. If any provision is unenforceable, the rest remains in effect. Questions: accounts@vlad.gg.",
  },
];

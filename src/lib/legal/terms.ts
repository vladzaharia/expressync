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
      "These Terms are a binding agreement between you and Polaris Express (“we,” “us”). They cover your use of example.com, the ExpressCharge iOS app, your charging card, and any charging session at our stations. If you don't agree with them, don't use the service. You must be at least 18 — or whatever age makes you a legal adult where you live — to enter into this agreement.",
  },
  {
    id: "your-account",
    icon: "UserCheck",
    title: "Your Account",
    summary: "Keep your information accurate and your sign-in to yourself.",
    body:
      "You're responsible for keeping the email address and any other information on your account accurate, and for anything done under your account. Don't share your sign-in, and don't use anyone else's account or charging card. If you think someone else is using your account, email accounts@vlad.gg right away so we can lock it.",
  },
  {
    id: "the-service",
    icon: "Zap",
    title: "The Service",
    summary: "ExpressCharge lets you tap to start charging at Polaris EV stations.",
    body:
      "ExpressCharge has three parts: (a) the example.com website, (b) the iOS companion app, which reads your charging card and shows you what's happening, and (c) the backend systems that authorize sessions and meter your charging at Polaris-operated EV stations. The website and the app are interfaces to the same service; whenever they show different numbers, the server's record is the one we'll bill from.",
  },
  {
    id: "acceptable-use",
    icon: "ShieldAlert",
    title: "Acceptable Use",
    summary: "Use the app and stations the way they're meant to be used.",
    body:
      "We give you permission to use the iOS app and the website for the ordinary purpose of charging your vehicle. That permission is personal to you, isn't transferable, and we can withdraw it. In particular, you agree not to:",
    bullets: [
      "reverse engineer, decompile, or otherwise try to pull the source out of the app",
      "scrape, automate, or otherwise abuse the service or its APIs",
      "interfere with charging sessions, reservations, or other users",
      "use a card or an account that isn't yours",
      "use the service in a way that breaks the law or harms other people or our equipment",
    ],
  },
  {
    id: "fees-and-billing",
    icon: "CreditCard",
    title: "Fees & Billing",
    summary:
      "You pay per kWh of charging delivered. Your first charging card is free; additional cards are $3.",
    body:
      "Charging is metered per kilowatt-hour delivered, and your invoice is calculated by our billing system. Rates may vary by station and time of day; where required by law, the rate will be shown to you before the session starts. Your first charging card is free, and additional or replacement cards are $3 each. If you opt into a subscription plan, it's billed on the cadence shown at sign-up and renews until you cancel. Taxes are added where applicable. If you want to dispute a charge, please raise it within 60 days of the invoice date.",
  },
  {
    id: "reservations-cancellations",
    icon: "CalendarClock",
    title: "Reservations & Cancellations",
    summary:
      "You can reserve a charger and connector for a time window; cancel through the app.",
    body:
      "A reservation holds a specific charger and connector for the time window you pick, and is tied to a specific charging card. You can cancel through the app or website any time before the window starts. If you don't show up, or you stay past the window, you may be charged a no-show or overstay fee at the rate posted when you booked.",
  },
  {
    id: "safety-equipment",
    icon: "AlertTriangle",
    title: "Safety & Equipment",
    summary:
      "The stations belong to the operator; follow on-site instructions and don't damage them.",
    body:
      "The charging stations are owned and maintained by Polaris Express. When you use one, please follow the on-site signage, the operator's safety instructions, and any applicable law. Only use equipment that's in good working order, and only with a vehicle whose port matches the connector. You're responsible for damage you cause to a station through misuse, negligence, or unauthorized modification.",
  },
  {
    id: "disclaimers-liability",
    icon: "ScrollText",
    title: "Disclaimers & Liability",
    summary:
      "We provide the service “as is” and our total liability is capped at what you paid us in the last 12 months.",
    body:
      "We provide ExpressCharge “as is” and “as available,” without warranties of any kind, express or implied — including merchantability, fitness for a particular purpose, and non-infringement — to the maximum extent the law allows. We can't guarantee that any specific charger will be free when you arrive, that charging speeds will hit a particular number, or that the service will never go down. If you do bring a claim against us, our total liability to you for everything related to the service is capped at the greater of (a) what you paid us in the 12 months before the event that caused the claim, or (b) USD $100. Nothing in these Terms limits liability that the law says we can't limit — for example, gross negligence, willful misconduct, or, for EU consumers, your statutory consumer rights.",
  },
  {
    id: "indemnity",
    icon: "Handshake",
    title: "Mutual Indemnity",
    summary:
      "Each side covers the other for losses caused by its own misuse or breach.",
    body:
      "If a third party sues us because of how you used the service — including breaking these Terms or breaking the law — you'll cover our reasonable legal costs and any damages. If a third party sues you because the service itself (used the way we allow) infringes their intellectual property, we'll cover yours. Whichever side is being indemnified must let the other side know promptly and cooperate; the side paying the bill gets to control the defense and approve any settlement, as long as that settlement fully releases the indemnified side.",
  },
  {
    id: "termination",
    icon: "Trash2",
    title: "Termination",
    summary:
      "Either of us can end this with reasonable notice; your data is handled per the Privacy Policy.",
    body:
      "You can close your account any time through the app, the website, or by emailing accounts@vlad.gg. We can suspend or end your access with reasonable notice — or immediately if there's a serious breach of these Terms, suspected fraud, or a safety reason. When the agreement ends, any unpaid fees are still owed, and your data is kept, deleted, or anonymized as described in the Privacy Policy.",
  },
  {
    id: "law-and-disputes",
    icon: "Gavel",
    title: "Governing Law & Disputes",
    summary:
      "Washington State law applies; we try to resolve disputes informally first, then through individual arbitration.",
    body:
      "These Terms are governed by the laws of the State of Washington, USA, without applying its conflict-of-laws rules. Before bringing a formal dispute, please email accounts@vlad.gg and give us 30 days to resolve it. If that doesn't work, the dispute will be settled by binding, individual arbitration seated in King County, Washington, under the rules of a recognized arbitral body (for example, the AAA Consumer Rules). You and we each give up the right to take part in a class action or class-wide arbitration. Either of us can still file a small-claims case, or go to court to stop ongoing intellectual-property misuse. If you're an EU or UK consumer, this clause only applies to the extent your local law allows, and you keep the right to sue in the courts of the country where you live.",
  },
  {
    id: "changes-and-contact",
    icon: "Bell",
    title: "Changes & Contact",
    summary:
      "We'll tell you before we change these Terms; reach us anytime at accounts@vlad.gg.",
    body:
      "We may update these Terms from time to time. For meaningful changes, we'll tell you in the app and by email at least 14 days before they take effect — continuing to use the service after that date means you accept the updated Terms. If you don't accept the changes, you can close your account before the effective date. These Terms, together with the Privacy Policy, make up the full agreement between you and Polaris Express on this subject. If any single part of them turns out to be unenforceable, the rest still applies. Questions: accounts@vlad.gg.",
  },
];

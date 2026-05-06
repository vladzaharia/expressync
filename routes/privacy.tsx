/**
 * GET /privacy — public Privacy Policy page.
 *
 * Reachable on both surfaces (route-classifier marks `/privacy` PUBLIC).
 * The Apple Developer / App Store Connect privacy URL points here, and
 * search engines / unauth'd visitors land here directly, so the page
 * does not depend on `state.user`.
 */

import { define } from "../utils.ts";
import { LegalShell } from "../components/legal/LegalShell.tsx";
import { LegalDocument } from "../components/legal/LegalDocument.tsx";
import {
  PRIVACY_CARDS,
  PRIVACY_GATE_ID,
  PRIVACY_META,
} from "../src/lib/legal/privacy-policy.ts";

export default define.page(function PrivacyPage() {
  return (
    <LegalShell
      title={PRIVACY_META.title}
      description={PRIVACY_META.description}
      active="privacy"
    >
      <LegalDocument
        meta={PRIVACY_META}
        cards={PRIVACY_CARDS}
        emphasizedCardId={PRIVACY_GATE_ID}
      />
    </LegalShell>
  );
});

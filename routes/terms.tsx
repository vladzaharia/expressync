/**
 * GET /terms — public Terms of Service page.
 *
 * The first card (`agreement-gate`) is rendered with extra emphasis at the
 * top of the stack since reading it is the legally-significant act that
 * binds the contract.
 */

import { define } from "../utils.ts";
import { LegalShell } from "../components/legal/LegalShell.tsx";
import { LegalDocument } from "../components/legal/LegalDocument.tsx";
import {
  TERMS_CARDS,
  TERMS_GATE_ID,
  TERMS_META,
} from "../src/lib/legal/terms.ts";

export default define.page(function TermsPage() {
  return (
    <LegalShell
      title={TERMS_META.title}
      description={TERMS_META.description}
      active="terms"
    >
      <LegalDocument
        meta={TERMS_META}
        cards={TERMS_CARDS}
        emphasizedCardId={TERMS_GATE_ID}
      />
    </LegalShell>
  );
});

/**
 * TagFormWrapper — single island composing <Form> chrome around <TagForm>.
 *
 * Used by:
 *   - `routes/admin/tags/new.tsx` (mode=create, wizard step 1; on success
 *      navigates to /tags/[pk]/link?fromCreate=1).
 *   - `routes/admin/tags/[tagPk]/edit.tsx` (mode=edit; standalone unless
 *      ?next=link, in which case primary becomes "Continue" and navigates
 *      to /tags/[pk]/link?fromCreate=1).
 */

import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Form } from "@/components/shared/Form.tsx";
import TagForm, {
  type TagFormHandle,
  type TagFormInitial,
} from "@/islands/TagForm.tsx";
import type { ParentCandidate } from "@/components/tags/ParentTagGrid.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  mode: "create" | "edit";
  initial?: Partial<TagFormInitial> & { idTag?: string };
  parentCandidates: ParentCandidate[];
  /** Cancel destination (used when not multi-step). */
  cancelHref: string;
  /**
   * When set, on a successful create the wrapper navigates to step 2
   * (`/tags/{pk}/link?fromCreate=1`). When unset, navigates to the tag
   * detail page.
   */
  navigateToLinkOnSuccess?: boolean;
  /**
   * Multi-step mode — drives the dots indicator + label. Defaults to
   * a single-step layout.
   */
  multiStep?: { steps: number; current: number };
  /**
   * When the wrapper is the edit form mounted from the wizard's Back
   * (?next=link) — primary label becomes "Continue" and on save the
   * user lands back on /tags/{pk}/link?fromCreate=1.
   */
  nextIsLink?: boolean;
}

export default function TagFormWrapper(props: Props) {
  const {
    mode,
    initial,
    parentCandidates,
    cancelHref,
    navigateToLinkOnSuccess,
    multiStep,
    nextIsLink,
  } = props;

  const formRef = useRef<TagFormHandle>(null);
  const valid = useSignal(false);
  const submitting = useSignal(false);

  const submitLabel: "Create" | "Edit" | "Continue" = nextIsLink
    ? "Continue"
    : mode === "create"
    ? "Create"
    : "Edit";

  return (
    <Form
      steps={multiStep?.steps}
      current={multiStep?.current}
      cancel={{ href: cancelHref }}
      submit={{
        label: submitLabel,
        disabled: !valid.value,
        pending: submitting.value,
        onClick: () => {
          submitting.value = true;
          formRef.current?.submit();
        },
      }}
    >
      <TagForm
        ref={formRef}
        mode={mode}
        initial={initial}
        parentCandidates={parentCandidates}
        onValidityChange={(v) => (valid.value = v)}
        onSuccess={({ tagPk }) => {
          if (mode === "create" && navigateToLinkOnSuccess) {
            clientNavigate(`/tags/${tagPk}/link?fromCreate=1`);
            return;
          }
          if (nextIsLink) {
            clientNavigate(`/tags/${tagPk}/link?fromCreate=1`);
            return;
          }
          clientNavigate(`/tags/${tagPk}`);
        }}
        onError={() => (submitting.value = false)}
      />
    </Form>
  );
}

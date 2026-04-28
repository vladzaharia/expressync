/**
 * LinkingFormWrapper — single island that composes <Form> chrome around
 * <LinkingForm>, owning the ref + valid/dirty wiring + navigation.
 *
 * Rendered by `routes/admin/tags/[tagPk]/link.tsx`. Three modes derive
 * from loader data:
 *   - fromCreate=1 → wizard step 2 (Back, Skip, primary "Create").
 *   - mode=create   → standalone create (Cancel, primary "Create").
 *   - mode=edit     → standalone edit (Cancel, primary "Edit").
 */

import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Form } from "@/components/shared/Form.tsx";
import LinkingForm, {
  type LinkingFormHandle,
  type LinkingFormSeed,
} from "@/islands/LinkingForm.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  tag: {
    ocppTagPk: number;
    idTag: string;
    displayName: string | null;
    tagType: string | null;
    isMeta: boolean;
    isActive: boolean;
    parentIdTag: string | null;
  };
  seed: LinkingFormSeed | null;
  mode: "create" | "edit";
  fromCreate: boolean;
  preselectedCustomerId: string | null;
  lagoDashboardUrl: string;
}

export default function LinkingFormWrapper(
  { tag, seed, mode, fromCreate, preselectedCustomerId, lagoDashboardUrl }:
    Props,
) {
  const formRef = useRef<LinkingFormHandle>(null);
  const valid = useSignal(false);
  const submitting = useSignal(false);

  const detailHref = `/tags/${tag.ocppTagPk}`;
  const editHref = `/tags/${tag.ocppTagPk}/edit?next=link`;

  const onSuccess = () => clientNavigate(detailHref);

  const submitLabel: "Create" | "Edit" = mode === "edit" ? "Edit" : "Create";

  return (
    <Form
      steps={fromCreate ? 2 : undefined}
      current={fromCreate ? 2 : undefined}
      back={fromCreate
        ? { onClick: () => clientNavigate(editHref) }
        : undefined}
      skip={fromCreate
        ? { onClick: () => clientNavigate(detailHref) }
        : undefined}
      cancel={!fromCreate ? { href: detailHref } : undefined}
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
      <LinkingForm
        ref={formRef}
        mode={mode}
        tag={tag}
        seed={seed ?? undefined}
        preselectedCustomerId={preselectedCustomerId}
        lagoDashboardUrl={lagoDashboardUrl}
        onValidityChange={(v) => (valid.value = v)}
        onSuccess={onSuccess}
        onError={() => (submitting.value = false)}
      />
    </Form>
  );
}

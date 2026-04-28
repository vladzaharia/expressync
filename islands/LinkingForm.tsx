/**
 * LinkingForm — pure-fields tag ↔ customer ↔ subscription form.
 *
 * Wrapped by `<Form>` (single-step on /admin/tags/[pk]/link, or wizard
 * step 2 of /admin/tags/new). The tag is fixed by the route — the form
 * doesn't render a tag picker, just a `<TagHeaderStrip>` for identity
 * confirmation. Customer + Subscription pickers stack as two SectionCards.
 *
 * Submission is triggered imperatively via the ref; the chrome reads the
 * imperative `submit()` and disabled state is driven by `onValidityChange`.
 *
 * The `parent_id_tag` for the linked tag is set automatically server-side
 * (from the linked customer's `OCPP-{externalId}` meta-tag) — no parent
 * field is rendered here.
 */

import { forwardRef } from "preact/compat";
import { useImperativeHandle } from "preact/hooks";
import { effect, useSignal } from "@preact/signals";
import { CreditCard, Loader2, User } from "lucide-preact";
import CustomerPicker from "@/islands/linking/CustomerPicker.tsx";
import SubscriptionPicker from "@/islands/linking/SubscriptionPicker.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { TagHeaderStrip } from "@/components/tags/TagHeaderStrip.tsx";

export interface LinkingFormHandle {
  submit: () => void;
}

export interface LinkingFormSeed {
  /** user_mappings.id when editing an existing link. */
  mappingId: number;
  lagoCustomerExternalId: string | null;
  lagoSubscriptionExternalId: string | null;
}

export interface LinkingFormProps {
  mode: "create" | "edit";
  /** Tag identity (always present). */
  tag: {
    ocppTagPk: number;
    idTag: string;
    displayName: string | null;
    tagType: string | null;
    isMeta: boolean;
    isActive: boolean;
    parentIdTag: string | null;
  };
  /** Existing mapping seed (edit mode). */
  seed?: LinkingFormSeed;
  /** Customer prefill (e.g. ?customerId= deep-link). */
  preselectedCustomerId?: string | null;
  lagoDashboardUrl?: string | null;
  onValidityChange?: (valid: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSuccess?: (result: { mappingId: number }) => void;
  onError?: (message: string) => void;
}

function LinkingFormInner(
  props: LinkingFormProps,
  ref: preact.Ref<LinkingFormHandle>,
) {
  const {
    mode,
    tag,
    seed,
    preselectedCustomerId,
    lagoDashboardUrl,
    onValidityChange,
    onDirtyChange,
  } = props;

  const lagoCustomerId = useSignal(
    seed?.lagoCustomerExternalId ?? preselectedCustomerId ?? "",
  );
  const lagoSubscriptionId = useSignal(
    seed?.lagoSubscriptionExternalId ?? "",
  );
  const saving = useSignal(false);
  const errorMessage = useSignal<string | null>(null);

  const initialCustomer = seed?.lagoCustomerExternalId ?? "";
  const initialSubscription = seed?.lagoSubscriptionExternalId ?? "";

  effect(() => {
    onValidityChange?.(lagoCustomerId.value.trim().length > 0);
    onDirtyChange?.(
      lagoCustomerId.value !== initialCustomer ||
        lagoSubscriptionId.value !== initialSubscription,
    );
  });

  const submit = async () => {
    if (saving.value) return;
    if (!lagoCustomerId.value) {
      errorMessage.value = "Please select a Lago customer.";
      return;
    }
    saving.value = true;
    errorMessage.value = null;
    try {
      const isEdit = mode === "edit" && seed?.mappingId;
      const url = isEdit
        ? `/api/admin/tag/link?id=${seed!.mappingId}`
        : "/api/admin/tag/link";
      const method = isEdit ? "PUT" : "POST";

      const body = isEdit
        ? {
          lagoCustomerExternalId: lagoCustomerId.value,
          lagoSubscriptionExternalId: lagoSubscriptionId.value || null,
          // The Active flag is owned by TagForm/TagMetadataForm now; don't
          // send it from here so it doesn't accidentally override.
        }
        : {
          ocppTagId: tag.idTag,
          ocppTagPk: tag.ocppTagPk,
          lagoCustomerId: lagoCustomerId.value,
          lagoSubscriptionId: lagoSubscriptionId.value || null,
          isActive: true,
        };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === "string"
          ? data.error
          : `Failed to save (${res.status})`;
        errorMessage.value = msg;
        props.onError?.(msg);
        return;
      }

      const mappingId = isEdit
        ? seed!.mappingId
        : Number(data.parentMapping?.id ?? data.mappingId ?? 0);
      props.onSuccess?.({ mappingId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorMessage.value = msg;
      props.onError?.(msg);
    } finally {
      saving.value = false;
    }
  };

  useImperativeHandle(ref, () => ({ submit }), []);

  return (
    <div class="space-y-6">
      <TagHeaderStrip
        idTag={tag.idTag}
        displayName={tag.displayName}
        tagType={tag.tagType}
        isMeta={tag.isMeta}
        isLinked={Boolean(seed?.lagoCustomerExternalId)}
        isActive={tag.isActive}
        parentIdTag={tag.parentIdTag}
      />

      <SectionCard title="Customer" icon={User} accent="cyan">
        <CustomerPicker
          value={lagoCustomerId.value}
          onChange={(id) => {
            if (id !== lagoCustomerId.value) {
              lagoSubscriptionId.value = "";
            }
            lagoCustomerId.value = id;
          }}
          lagoDashboardUrl={lagoDashboardUrl}
        />
      </SectionCard>

      <SectionCard title="Subscription" icon={CreditCard} accent="cyan">
        <SubscriptionPicker
          customerId={lagoCustomerId.value || null}
          value={lagoSubscriptionId.value || null}
          onChange={(id) => {
            lagoSubscriptionId.value = id ?? "";
          }}
          lagoDashboardUrl={lagoDashboardUrl}
        />
      </SectionCard>

      <p class="text-xs text-muted-foreground italic">
        Linking will inherit StEvE config from the customer's auto-managed
        meta-tag — no manual parent setup needed.
      </p>

      {errorMessage.value
        ? (
          <div class="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
            {errorMessage.value}
          </div>
        )
        : null}

      {saving.value
        ? (
          <p class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 class="size-3 animate-spin" />
            Saving…
          </p>
        )
        : null}
    </div>
  );
}

const LinkingForm = forwardRef<LinkingFormHandle, LinkingFormProps>(
  LinkingFormInner,
);
export default LinkingForm;

/**
 * MappingForm — tag ↔ customer ↔ subscription linker.
 *
 * After the Phase P2 refactor this form owns only the orchestration:
 *   - Step rail (Tag → Customer → Subscription).
 *   - Three pickers extracted into `islands/linking/` as separate islands.
 *   - Submit to `POST /api/tag/link` (create) or `PUT /api/tag/link?id=`
 *     (update).
 *
 * What this file deliberately does NOT own anymore:
 *   - Tag Type selector — lives on `/tags/[tagPk]` via `TagMetadataForm`.
 *   - Tag metadata fields (displayName, notes) — same.
 *   - Inline tag creation — `/tags/new` is the one place to create tags.
 *
 * The legacy `linkingOnly` prop is gone; every caller gets the slim form.
 */

import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Check, CreditCard, Loader2, Tag, User } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import TagPicker from "@/islands/linking/TagPicker.tsx";
import CustomerPicker from "@/islands/linking/CustomerPicker.tsx";
import SubscriptionPicker from "@/islands/linking/SubscriptionPicker.tsx";
import { isMetaTag } from "@/src/lib/tag-hierarchy.ts";

interface MappingSeed {
  id: number;
  steveOcppIdTag: string;
  steveOcppTagPk: number;
  lagoCustomerExternalId: string | null;
  lagoSubscriptionExternalId: string | null;
  isActive: boolean | null;
}

interface Props {
  /** When present, the form runs in edit mode and targets PUT. */
  mapping?: MappingSeed;
  /** Preselected OCPP tag id (create mode, from query). */
  preselectedTagId?: string | null;
  /** Preselected OCPP tag primary key to avoid an extra fetch. */
  preselectedTagPk?: number | null;
  /** Preselected Lago customer external id (create mode, from query). */
  preselectedCustomerId?: string | null;
  /** When truthy, the form emits `/links/[id]` on successful create instead
   *  of navigating to `/links`. */
  lagoDashboardUrl?: string | null;
  /** Title override for the step rail's screen-reader label. */
  ariaLabel?: string;
}

export default function MappingForm(props: Props) {
  const {
    mapping,
    preselectedTagId,
    preselectedTagPk,
    preselectedCustomerId,
    lagoDashboardUrl,
    ariaLabel,
  } = props;

  const ocppTagId = useSignal(
    mapping?.steveOcppIdTag ?? preselectedTagId ?? "",
  );
  const ocppTagPk = useSignal(
    mapping?.steveOcppTagPk ?? preselectedTagPk ?? 0,
  );
  const lagoCustomerId = useSignal(
    mapping?.lagoCustomerExternalId ?? preselectedCustomerId ?? "",
  );
  const lagoSubscriptionId = useSignal(
    mapping?.lagoSubscriptionExternalId ?? "",
  );
  const isActive = useSignal(mapping?.isActive ?? true);
  const loading = useSignal(false);
  const error = useSignal("");
  const successMessage = useSignal("");

  // When the operator changes the customer, clear any previously selected
  // subscription so it doesn't leak across customers.
  useEffect(() => {
    if (!mapping) {
      // Fresh form — no-op.
    }
  }, []);

  const currentStep = useComputed(() => {
    if (!ocppTagId.value) return 1;
    if (!lagoCustomerId.value) return 2;
    return 3;
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (!ocppTagId.value) {
      error.value = "Please select an OCPP tag.";
      return;
    }
    if (!lagoCustomerId.value) {
      error.value = "Please select a Lago customer.";
      return;
    }

    loading.value = true;
    error.value = "";
    successMessage.value = "";

    try {
      const url = mapping
        ? `/api/admin/tag/link?id=${mapping.id}`
        : "/api/admin/tag/link";
      const method = mapping ? "PUT" : "POST";

      const body = mapping
        ? {
          // On update the backend only reads keys it recognizes. Send the
          // triple so swapping customer/sub works, plus isActive.
          lagoCustomerExternalId: lagoCustomerId.value,
          lagoSubscriptionExternalId: lagoSubscriptionId.value || null,
          isActive: isActive.value,
        }
        : {
          ocppTagId: ocppTagId.value,
          ocppTagPk: ocppTagPk.value,
          lagoCustomerId: lagoCustomerId.value,
          lagoSubscriptionId: lagoSubscriptionId.value || null,
          isActive: isActive.value,
        };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.totalCreated && data.totalCreated > 1) {
          successMessage.value =
            `Successfully created ${data.totalCreated} mappings (1 parent + ${
              data.totalCreated - 1
            } children)`;
          setTimeout(() => {
            globalThis.location.href = "/links";
          }, 1500);
        } else if (!mapping && data.parentMapping?.id) {
          globalThis.location.href = `/links/${data.parentMapping.id}`;
        } else {
          globalThis.location.href = "/links";
        }
      } else {
        const data = await res.json().catch(() => ({}));
        error.value = data.error ?? "Failed to save mapping.";
      }
    } catch (_err) {
      error.value = "An error occurred. Please try again.";
    } finally {
      loading.value = false;
    }
  };

  const metaSelected = isMetaTag(ocppTagId.value);

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      aria-label={ariaLabel ?? "Tag linking form"}
    >
      {/* Step rail */}
      <div className="flex items-center justify-between mb-8">
        <StepIndicator
          step={1}
          label="Tag"
          icon={Tag}
          currentStep={currentStep.value}
        />
        <div
          className={cn(
            "flex-1 h-0.5 mx-2 transition-colors",
            currentStep.value >= 2 ? "bg-violet-500" : "bg-muted",
          )}
        />
        <StepIndicator
          step={2}
          label="Customer"
          icon={User}
          currentStep={currentStep.value}
        />
        <div
          className={cn(
            "flex-1 h-0.5 mx-2 transition-colors",
            currentStep.value >= 3 ? "bg-violet-500" : "bg-muted",
          )}
        />
        <StepIndicator
          step={3}
          label="Subscription"
          icon={CreditCard}
          currentStep={currentStep.value}
        />
      </div>

      {error.value && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive p-3 rounded-md text-sm border border-destructive/20"
        >
          {error.value}
        </div>
      )}

      {successMessage.value && (
        <div
          role="status"
          aria-live="polite"
          className="bg-green-500/10 text-green-600 p-3 rounded-md text-sm border border-green-500/20"
        >
          {successMessage.value}
        </div>
      )}

      <TagPicker
        value={ocppTagId.value}
        valuePk={ocppTagPk.value}
        onChange={(id, pk) => {
          ocppTagId.value = id;
          ocppTagPk.value = pk;
        }}
        mappingId={mapping?.id}
        label={metaSelected ? "Meta-tag" : undefined}
      />

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

      <SubscriptionPicker
        customerId={lagoCustomerId.value || null}
        value={lagoSubscriptionId.value || null}
        onChange={(id) => {
          lagoSubscriptionId.value = id;
        }}
        lagoDashboardUrl={lagoDashboardUrl}
      />

      {
        /* Active toggle — hidden for create flow (defaults true). The edit
          page relocates this into the danger zone, so we only render here
          when we're NOT on /links/[id]. */
      }
      {!mapping && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isActive"
            checked={isActive.value}
            onCheckedChange={(checked) => (isActive.value = checked)}
            className="border-purple-500 data-[state=checked]:bg-purple-600 data-[state=checked]:text-white"
          />
          <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <Button
          type="submit"
          disabled={loading.value}
          className="bg-purple-600 hover:bg-purple-700 text-white"
        >
          {loading.value
            ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            )
            : (
              <>
                <Check className="mr-2 size-4" />
                {mapping ? "Update link" : "Create link"}
              </>
            )}
        </Button>
        <Button
          variant="outline"
          asChild
          className="border-red-500 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
        >
          <a href="/links">Cancel</a>
        </Button>
      </div>
    </form>
  );
}

function StepIndicator(
  { step, label, icon: Icon, currentStep }: {
    step: number;
    label: string;
    icon: typeof Tag;
    currentStep: number;
  },
) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex items-center justify-center size-8 rounded-full transition-colors",
          currentStep >= step
            ? "bg-violet-500 text-white"
            : "bg-muted text-muted-foreground",
        )}
      >
        {currentStep > step
          ? <Check className="size-4" />
          : <Icon className="size-4" />}
      </div>
      <span
        className={cn(
          "text-sm font-medium hidden sm:inline",
          currentStep >= step ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

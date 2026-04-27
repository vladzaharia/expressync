/**
 * ScanTagAction — header-action button on /tags. Dispatches the global
 * `evcard:scan-open` CustomEvent so the modal is opened by the single
 * `<ScanModalHost>` mounted in `_app.tsx`. The host handles routing on
 * detection.
 */

import { Radio } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import {
  SCAN_OPEN_EVENT,
  type ScanOpenDetail,
} from "@/islands/shared/ScanModalHost.tsx";

interface Props {
  /** Override the button caption. Defaults to "Scan Tag". */
  buttonLabel?: string;
}

export default function ScanTagAction({ buttonLabel = "Scan Tag" }: Props) {
  const handleClick = () => {
    const detail: ScanOpenDetail = { mode: "admin", purpose: "lookup-tag" };
    globalThis.dispatchEvent(new CustomEvent(SCAN_OPEN_EVENT, { detail }));
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick}>
      <Radio class="mr-2 h-4 w-4" />
      {buttonLabel}
    </Button>
  );
}

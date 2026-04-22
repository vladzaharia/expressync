/**
 * CommandGroup — heading + `Command.Group` wrapper for the ⌘K palette
 * (Phase P6). Thin presentational component; cmdk handles filtering.
 */

import { Command } from "cmdk";
import type { ComponentChildren } from "preact";

interface CommandGroupProps {
  heading: string;
  children: ComponentChildren;
}

export function CommandGroup({ heading, children }: CommandGroupProps) {
  return (
    <Command.Group
      heading={heading}
      className="px-2 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  );
}

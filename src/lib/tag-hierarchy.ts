import type { StEvEOcppTag } from "./types/steve.ts";

/**
 * Prefix marking a tag as a "meta-tag" — a parent tag used purely to group
 * other tags under a single customer (e.g. `OCPP-VLAD` sits above `1234` and
 * `ABCD1234567890`). Meta-tags never correspond to a physical card handed to
 * a customer; they exist solely for hierarchy rollup in StEvE so that one
 * customer can own multiple real tags without duplicating the mapping.
 *
 * Callers use this prefix to:
 *   - exclude meta-tag mappings from customer-facing surfaces (Lago invoice
 *     metadata, customer portal listings), and
 *   - reject attempts to issue a physical card against the meta-tag itself.
 */
export const META_TAG_PREFIX = "OCPP-" as const;

/** True if the OCPP id tag is a meta-tag by naming convention. */
export function isMetaTag(idTag: string | null | undefined): boolean {
  return typeof idTag === "string" && idTag.startsWith(META_TAG_PREFIX);
}

/**
 * Get all child tags (direct and indirect descendants) of a parent tag
 *
 * @param parentIdTag - The parent tag ID to find children for
 * @param allTags - All available OCPP tags
 * @returns Array of all descendant tags
 */
export function getAllChildTags(
  parentIdTag: string,
  allTags: StEvEOcppTag[],
): StEvEOcppTag[] {
  const children: StEvEOcppTag[] = [];
  // Seed visited with the starting tag so a cycle that loops back to it
  // (e.g. A -> B -> A) is skipped instead of re-included as its own descendant.
  const visited = new Set<string>([parentIdTag]);

  function findChildren(currentParentId: string) {
    const directChildren = allTags.filter(
      (tag) => tag.parentIdTag === currentParentId,
    );

    for (const child of directChildren) {
      if (visited.has(child.idTag)) continue;
      visited.add(child.idTag);
      children.push(child);
      findChildren(child.idTag);
    }
  }

  findChildren(parentIdTag);
  return children;
}

/**
 * Get the parent tag of a given tag
 *
 * @param tag - The tag to find parent for
 * @param allTags - All available OCPP tags
 * @returns The parent tag or null if no parent exists
 */
export function getParentTag(
  tag: StEvEOcppTag,
  allTags: StEvEOcppTag[],
): StEvEOcppTag | null {
  if (!tag.parentIdTag) {
    return null;
  }
  return allTags.find((t) => t.idTag === tag.parentIdTag) || null;
}

/**
 * Get all ancestor tags (parent, grandparent, etc.) of a given tag
 *
 * @param tag - The tag to find ancestors for
 * @param allTags - All available OCPP tags
 * @returns Array of ancestor tags, ordered from immediate parent to root
 */
export function getAllAncestorTags(
  tag: StEvEOcppTag,
  allTags: StEvEOcppTag[],
): StEvEOcppTag[] {
  const ancestors: StEvEOcppTag[] = [];
  // Seed visited with the starting tag so a cycle that loops back to it
  // (e.g. A -> B -> A) stops cleanly instead of re-including the start as an ancestor.
  const visited = new Set<string>([tag.idTag]);

  let current = tag;
  while (current.parentIdTag) {
    if (visited.has(current.parentIdTag)) break;
    visited.add(current.parentIdTag);

    const parent = allTags.find((t) => t.idTag === current.parentIdTag);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }

  return ancestors;
}

/**
 * Check if a tag is a descendant of another tag
 *
 * @param tag - The potential child tag
 * @param potentialAncestorIdTag - The potential ancestor tag ID
 * @param allTags - All available OCPP tags
 * @returns True if tag is a descendant of potentialAncestorIdTag
 */
export function isDescendantOf(
  tag: StEvEOcppTag,
  potentialAncestorIdTag: string,
  allTags: StEvEOcppTag[],
): boolean {
  const ancestors = getAllAncestorTags(tag, allTags);
  return ancestors.some((ancestor) =>
    ancestor.idTag === potentialAncestorIdTag
  );
}

/**
 * Build a hierarchical tree structure from flat tag list
 *
 * @param tags - All available OCPP tags
 * @returns Array of root tags with nested children
 */
export interface TagNode extends StEvEOcppTag {
  children: TagNode[];
}

export function buildTagTree(tags: StEvEOcppTag[]): TagNode[] {
  const tagMap = new Map<string, TagNode>();
  const rootTags: TagNode[] = [];

  // Create nodes for all tags
  for (const tag of tags) {
    tagMap.set(tag.idTag, { ...tag, children: [] });
  }

  // Build the tree structure
  for (const tag of tags) {
    const node = tagMap.get(tag.idTag)!;

    if (tag.parentIdTag) {
      const parent = tagMap.get(tag.parentIdTag);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent doesn't exist, treat as root
        rootTags.push(node);
      }
    } else {
      // No parent, this is a root tag
      rootTags.push(node);
    }
  }

  return rootTags;
}

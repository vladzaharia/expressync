import type { StEvEOcppTag } from "./types/steve.ts";

/**
 * Get all child tags (direct and indirect descendants) of a parent tag
 * 
 * @param parentIdTag - The parent tag ID to find children for
 * @param allTags - All available OCPP tags
 * @returns Array of all descendant tags
 */
export function getAllChildTags(
  parentIdTag: string,
  allTags: StEvEOcppTag[]
): StEvEOcppTag[] {
  const children: StEvEOcppTag[] = [];
  const visited = new Set<string>();

  function findChildren(currentParentId: string) {
    // Prevent infinite loops
    if (visited.has(currentParentId)) {
      return;
    }
    visited.add(currentParentId);

    // Find direct children
    const directChildren = allTags.filter(
      (tag) => tag.parentIdTag === currentParentId
    );

    for (const child of directChildren) {
      children.push(child);
      // Recursively find grandchildren
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
  allTags: StEvEOcppTag[]
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
  allTags: StEvEOcppTag[]
): StEvEOcppTag[] {
  const ancestors: StEvEOcppTag[] = [];
  const visited = new Set<string>();

  let current = tag;
  while (current.parentIdTag) {
    // Prevent infinite loops
    if (visited.has(current.parentIdTag)) {
      break;
    }
    visited.add(current.parentIdTag);

    const parent = allTags.find((t) => t.idTag === current.parentIdTag);
    if (!parent) {
      break;
    }
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
  allTags: StEvEOcppTag[]
): boolean {
  const ancestors = getAllAncestorTags(tag, allTags);
  return ancestors.some((ancestor) => ancestor.idTag === potentialAncestorIdTag);
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


export const GROUP_PATH_SEPARATOR = "/";

export interface GroupTreeNode {
  path: string;
  name: string;
  children: GroupTreeNode[];
}

export interface FlattenedGroupNode {
  path: string;
  name: string;
  depth: number;
  parentPath: string | null;
  hasChildren: boolean;
}

export function normalizeGroupPath(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value
    .split(GROUP_PATH_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(GROUP_PATH_SEPARATOR);

  return normalized || undefined;
}

export function getGroupParentPath(path: string): string | null {
  const normalized = normalizeGroupPath(path);
  if (!normalized) return null;

  const segments = normalized.split(GROUP_PATH_SEPARATOR);
  if (segments.length <= 1) return null;

  return segments.slice(0, -1).join(GROUP_PATH_SEPARATOR);
}

export function getGroupLeafName(path: string): string {
  const normalized = normalizeGroupPath(path);
  if (!normalized) return "";

  const segments = normalized.split(GROUP_PATH_SEPARATOR);
  return segments[segments.length - 1] ?? normalized;
}

export function joinGroupPath(parentPath: string | null | undefined, childName: string): string | undefined {
  const normalizedChild = normalizeGroupPath(childName);
  if (!normalizedChild) return undefined;

  const normalizedParent = normalizeGroupPath(parentPath);
  return normalizedParent ? `${normalizedParent}${GROUP_PATH_SEPARATOR}${normalizedChild}` : normalizedChild;
}

export function isGroupInTree(groupPath: string | undefined | null, ancestorPath: string): boolean {
  const normalizedGroup = normalizeGroupPath(groupPath);
  const normalizedAncestor = normalizeGroupPath(ancestorPath);
  if (!normalizedGroup || !normalizedAncestor) return false;

  return (
    normalizedGroup === normalizedAncestor ||
    normalizedGroup.startsWith(`${normalizedAncestor}${GROUP_PATH_SEPARATOR}`)
  );
}

export function renameGroupPath(path: string, fromPath: string, toPath: string): string {
  const normalizedPath = normalizeGroupPath(path);
  const normalizedFrom = normalizeGroupPath(fromPath);
  const normalizedTo = normalizeGroupPath(toPath);

  if (!normalizedPath || !normalizedFrom || !normalizedTo) {
    return path;
  }

  if (normalizedPath === normalizedFrom) return normalizedTo;
  if (normalizedPath.startsWith(`${normalizedFrom}${GROUP_PATH_SEPARATOR}`)) {
    return `${normalizedTo}${normalizedPath.slice(normalizedFrom.length)}`;
  }

  return normalizedPath;
}

export function collectAllGroupPaths(groupPaths: Array<string | undefined | null>): string[] {
  const collected = new Set<string>();

  for (const rawPath of groupPaths) {
    const normalized = normalizeGroupPath(rawPath);
    if (!normalized) continue;

    const segments = normalized.split(GROUP_PATH_SEPARATOR);
    for (let index = 0; index < segments.length; index += 1) {
      collected.add(segments.slice(0, index + 1).join(GROUP_PATH_SEPARATOR));
    }
  }

  return Array.from(collected).sort((left, right) => left.localeCompare(right));
}

export function buildGroupTree(groupPaths: Array<string | undefined | null>): GroupTreeNode[] {
  const allPaths = collectAllGroupPaths(groupPaths);
  const nodes = new Map<string, GroupTreeNode>();

  for (const path of allPaths) {
    nodes.set(path, {
      path,
      name: getGroupLeafName(path),
      children: [],
    });
  }

  const roots: GroupTreeNode[] = [];

  for (const path of allPaths) {
    const node = nodes.get(path);
    if (!node) continue;

    const parentPath = getGroupParentPath(path);
    if (!parentPath) {
      roots.push(node);
      continue;
    }

    const parentNode = nodes.get(parentPath);
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: GroupTreeNode[]) => {
    items.sort((left, right) => left.name.localeCompare(right.name));
    items.forEach((item) => sortNodes(item.children));
  };

  sortNodes(roots);
  return roots;
}

export function flattenGroupTree(nodes: GroupTreeNode[]): FlattenedGroupNode[] {
  const flattened: FlattenedGroupNode[] = [];

  const visit = (node: GroupTreeNode, depth: number, parentPath: string | null) => {
    flattened.push({
      path: node.path,
      name: node.name,
      depth,
      parentPath,
      hasChildren: node.children.length > 0,
    });

    node.children.forEach((child) => visit(child, depth + 1, node.path));
  };

  nodes.forEach((node) => visit(node, 0, null));
  return flattened;
}

/**
 * Admin design system primitives — barrel export.
 *
 * Use named imports from "@/components/admin/ui" for the simple case:
 *
 *   import { AdminPage, AdminCard, AdminButton } from "@/components/admin/ui";
 *
 * Or import directly from a file when you only need the types:
 *
 *   import type { AdminTableColumn } from "@/components/admin/ui/AdminTable";
 */

export { AdminPage } from "./AdminPage";
export { AdminSection } from "./AdminSection";
export { AdminCard } from "./AdminCard";
export type { AdminCardVariant, AdminCardTone } from "./AdminCard";

export { AdminTable } from "./AdminTable";
export type {
  AdminTableColumn,
  AdminTableSort,
  SortDirection,
} from "./AdminTable";

export { AdminBadge } from "./AdminBadge";
export type { AdminBadgeVariant, AdminBadgeSize } from "./AdminBadge";

export { AdminEmptyState } from "./AdminEmptyState";
export { AdminSkeleton } from "./AdminSkeleton";
export type { AdminSkeletonVariant } from "./AdminSkeleton";

export { AdminToastProvider, useAdminToast } from "./AdminToast";
export { AdminBreadcrumbs } from "./AdminBreadcrumbs";
export type { AdminCrumb } from "./AdminBreadcrumbs";

export { AdminButton } from "./AdminButton";
export type { AdminButtonVariant, AdminButtonSize } from "./AdminButton";

export {
  AdminInput,
  AdminTextarea,
  AdminSelect,
  AdminCheckbox,
  AdminField,
} from "./AdminInput";

export { AdminSearchBar } from "./AdminSearchBar";

export { AdminFilterChips } from "./AdminFilterChips";
export type { FilterChip } from "./AdminFilterChips";

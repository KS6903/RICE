import type { AppSection } from "@rice-mill/shared";
import { useAccess } from "../hooks/useAccess";
import AccessDenied from "./AccessDenied";

/**
 * Route guard that limits a section to roles allowed by the access matrix.
 * Pairs with FeatureGate (subscription): wrap RoleGate outside FeatureGate so a
 * role with no access never even reaches the upgrade prompt.
 */
export default function RoleGate({
  section,
  children,
}: {
  section: AppSection;
  children: React.ReactNode;
}) {
  const { canView } = useAccess();
  if (!canView(section)) return <AccessDenied section={section} />;
  return <>{children}</>;
}

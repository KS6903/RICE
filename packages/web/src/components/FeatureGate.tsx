import { useFeature } from "../hooks/useFeature";
import UpgradeRequired from "./UpgradeRequired";

interface Props {
  code: string;
  label?: string;
  requires?: string;
  children: React.ReactNode;
}

export default function FeatureGate({ code, label, requires, children }: Props) {
  const allowed = useFeature(code);
  if (!allowed) return <UpgradeRequired feature={label || code} requires={requires} />;
  return <>{children}</>;
}

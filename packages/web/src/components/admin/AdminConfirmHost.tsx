import axios from "axios";
import ConfirmItsYou from "../ConfirmItsYou";
import { useAdminConfirmStore } from "../../stores/adminConfirmStore";
import { useAuthStore } from "../../stores/authStore";
import { csrfHeaders } from "../../services/api";
import { t } from "../../i18n";

/**
 * Asks BossAdmin for the password (and authenticator code) when a change needs
 * a fresh confirmation, then lets the waiting change go again. Rendered once,
 * at the root of the app.
 */
export default function AdminConfirmHost() {
  const open = useAdminConfirmStore((s) => s.open);
  const error = useAdminConfirmStore((s) => s.error);
  const settle = useAdminConfirmStore((s) => s.settle);
  const setError = useAdminConfirmStore((s) => s.setError);
  const usesCode = useAuthStore((s) => !!s.user?.mfa_enabled);

  const confirm = async (password: string, code: string) => {
    try {
      // Straight through axios: the app's own client would send a refused
      // confirmation back here in a loop.
      await axios.post(
        "/api/admin/confirm",
        { current_password: password, mfa_code: code || null },
        { withCredentials: true, headers: csrfHeaders() },
      );
      settle(true);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? t(detail) : t("That didn't work. Try again."));
    }
  };

  return (
    <ConfirmItsYou
      // Opened again after a refusal, so the fields start empty each time.
      key={error ?? "first"}
      open={open}
      usesCode={usesCode}
      reason={t(
        "Every change in BossAdmin needs you to confirm it's you. One confirmation lasts a few minutes, on this device only.",
      )}
      error={error ?? undefined}
      onConfirm={(p) => void confirm(p.password, p.code)}
      onCancel={() => settle(false)}
    />
  );
}

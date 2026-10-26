import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { clsx } from "clsx";
import { t } from "../i18n";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** A password field with an eye button that shows or hides what's typed.
 *  Takes every prop an <input> does, apart from `type`. */
const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className, disabled, ...props },
  ref,
) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        {...props}
        disabled={disabled}
        type={shown ? "text" : "password"}
        // Room for the eye, and no second eye from Edge's built-in reveal button.
        className={clsx(className, "pr-11 [&::-ms-reveal]:hidden")}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        disabled={disabled}
        aria-label={shown ? t("Hide password") : t("Show password")}
        aria-pressed={shown}
        title={shown ? t("Hide password") : t("Show password")}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-muted transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-50"
      >
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
});

export default PasswordInput;

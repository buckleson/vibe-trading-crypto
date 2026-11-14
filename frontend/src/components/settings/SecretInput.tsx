import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@/components/ui";

/** Password input with a show/hide toggle. */
export const SecretInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function SecretInput(props, ref) {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const label = visible
      ? t("settings.hideSecret", { defaultValue: "Hide value" })
      : t("settings.showSecret", { defaultValue: "Show value" });
    return (
      <div className="flex items-center gap-2">
        <Input ref={ref} type={visible ? "text" : "password"} autoComplete="off" {...props} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          title={label}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    );
  },
);

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/ui/cn";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "@/lib/auth/password-rules";

type Props = Omit<
  ComponentProps<typeof Input>,
  "type" | "autoComplete" | "minLength" | "maxLength" | "pattern" | "inputMode"
>;

export function EmailInput(props: Props) {
  return (
    <Input
      autoComplete="email"
      inputMode="email"
      type="email"
      placeholder="name@example.com"
      required
      {...props}
    />
  );
}

export function VerificationCodeInput(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const code = fragment.get("code");
    if (!code || !/^[0-9]{6}$/.test(code) || !inputRef.current) return;
    inputRef.current.value = code;
    fragment.delete("code");
    void navigate(
      { pathname: location.pathname, search: location.search, hash: fragment.toString() },
      { replace: true, preventScrollReset: true },
    );
  }, [location.hash, location.pathname, location.search, navigate]);

  return (
    <Input
      autoComplete="one-time-code"
      inputMode="numeric"
      type="text"
      minLength={6}
      maxLength={6}
      pattern="[0-9]{6}"
      required
      {...props}
      ref={inputRef}
    />
  );
}

export function PasswordInput({
  purpose = "current",
  className,
  ...props
}: Props & { purpose?: "current" | "new" }) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "隐藏密码" : "显示密码";
  return (
    <div className="relative min-w-0">
      <Input
        type={visible ? "text" : "password"}
        autoComplete={purpose === "new" ? "new-password" : "current-password"}
        minLength={purpose === "new" ? PASSWORD_MIN_LENGTH : undefined}
        maxLength={purpose === "new" ? PASSWORD_MAX_LENGTH : undefined}
        required
        {...props}
        className={cn("pr-12", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute inset-y-0 right-0 text-muted"
        aria-label={label}
        aria-controls={props.id}
        aria-pressed={visible}
        title={label}
        disabled={props.disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}

import type { ComponentProps } from "react";
import { Input } from "@/app/components/ui/input";
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
    />
  );
}

export function PasswordInput({
  purpose = "current",
  ...props
}: Props & { purpose?: "current" | "new" }) {
  return (
    <Input
      type="password"
      autoComplete={purpose === "new" ? "new-password" : "current-password"}
      minLength={purpose === "new" ? PASSWORD_MIN_LENGTH : undefined}
      maxLength={purpose === "new" ? PASSWORD_MAX_LENGTH : undefined}
      required
      {...props}
    />
  );
}

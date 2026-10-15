"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { IconButton } from "./IconButton";
import { EyeIcon, EyeOffIcon } from "./icons";
import { Input, type InputProps } from "./Input";

export type PasswordInputProps = Omit<InputProps, "type"> & {
  /** What the value is, for the reveal toggle's name ("Show API key"); default "password", translated. */
  subject?: string;
};

export function PasswordInput({ className, subject, ...props }: PasswordInputProps) {
  const t = useT();
  const name = subject ?? t("ui.password");
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={`pr-12 ${className ?? ""}`} {...props} />
      <IconButton
        label={t(visible ? "ui.hideSecret" : "ui.showSecret", { subject: name })}
        aria-pressed={visible}
        icon={visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0"
      />
    </div>
  );
}

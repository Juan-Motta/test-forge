"use client";

import { useState } from "react";
import { IconButton } from "./IconButton";
import { EyeIcon, EyeOffIcon } from "./icons";
import { Input, type InputProps } from "./Input";

export type PasswordInputProps = Omit<InputProps, "type">;

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={`pr-12 ${className ?? ""}`} {...props} />
      <IconButton
        label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        icon={visible ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0"
      />
    </div>
  );
}

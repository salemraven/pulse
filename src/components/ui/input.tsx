import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-md bg-surface px-3.5 text-sm text-fg placeholder:text-subtle",
        "shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-fg)_12%,transparent)]",
        "transition-[box-shadow] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-fg)_28%,transparent)]",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

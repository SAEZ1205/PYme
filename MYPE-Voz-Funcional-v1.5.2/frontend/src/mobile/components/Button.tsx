import type {
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "outline";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-[0_12px_24px_rgba(16,185,129,.22)] hover:brightness-105",
  secondary:
    "bg-ink text-white shadow-sm hover:bg-ink-soft",
  ghost:
    "bg-transparent text-ink-soft hover:bg-white/65",
  danger:
    "bg-error-500 text-white shadow-sm hover:bg-error-600",
  outline:
    "bg-white/70 text-ink border border-white/90 shadow-sm backdrop-blur-xl hover:bg-white",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3 py-2 min-h-10",
  md: "text-base px-4 py-2.5 min-h-11",
  lg: "text-base px-5 py-3.5 min-h-[52px]",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  children,
  ...props
}: Props) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}

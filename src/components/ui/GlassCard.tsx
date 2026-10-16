import type { HTMLAttributes, ReactNode } from "react";

type Variant = "default" | "strong" | "subtle" | "amber" | "danger";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  as?: "div" | "section" | "article";
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  default: "glass rounded-3xl",
  strong: "glass-strong rounded-3xl",
  subtle: "glass-subtle rounded-2xl",
  amber: "glass-amber rounded-2xl",
  danger: "glass-danger rounded-2xl",
};

export default function GlassCard({
  variant = "default",
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: GlassCardProps) {
  return (
    <Tag className={`${variantClasses[variant]} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

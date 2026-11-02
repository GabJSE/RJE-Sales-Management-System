import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rje-accent)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--rje-accent)] text-[var(--rje-on-accent)] hover:bg-[var(--rje-accent-hover)]",
        outline: "border border-[var(--rje-line)] bg-[var(--rje-surface)] text-[var(--rje-accent-text)] hover:bg-[var(--rje-hover)]",
        ghost: "text-[var(--rje-muted)] hover:bg-[var(--rje-hover)] hover:text-[var(--rje-ink)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

const Button = ({ className, variant, size, type = "button", ...props }) => (
  <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
);

export { Button, buttonVariants };

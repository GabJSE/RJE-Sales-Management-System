import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc99c] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#2f7547] text-white hover:bg-[#1f6136]",
        outline: "border border-[#d5e2d8] bg-white text-[#2f7547] hover:bg-[#e8f4eb]",
        ghost: "text-[#b7cfbc] hover:bg-white/10 hover:text-white",
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

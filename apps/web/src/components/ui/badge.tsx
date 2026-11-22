import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-zinc-100 text-zinc-900 shadow hover:bg-zinc-200",
        secondary:
          "border-transparent bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
        destructive:
          "bg-red-950/80 text-red-300 border border-red-800 [html[data-appearance='light']_&]:bg-red-50 [html[data-appearance='light']_&]:text-red-700 [html[data-appearance='light']_&]:border-red-300",
        outline: "text-zinc-300 border-zinc-700",
        success:
          "bg-emerald-950/80 text-emerald-300 border border-emerald-800 [html[data-appearance='light']_&]:bg-emerald-50 [html[data-appearance='light']_&]:text-emerald-700 [html[data-appearance='light']_&]:border-emerald-300",
        warning:
          "bg-amber-950/80 text-amber-300 border border-amber-800 [html[data-appearance='light']_&]:bg-amber-50 [html[data-appearance='light']_&]:text-amber-800 [html[data-appearance='light']_&]:border-amber-300",
        info:
          "bg-blue-950/80 text-blue-300 border border-blue-800 [html[data-appearance='light']_&]:bg-blue-50 [html[data-appearance='light']_&]:text-blue-700 [html[data-appearance='light']_&]:border-blue-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

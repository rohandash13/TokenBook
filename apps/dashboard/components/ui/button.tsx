import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
const styles = cva("inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime-600", { variants: { variant: { default: "bg-[#203c30] text-white hover:bg-[#315640]", outline: "border border-[#d9dcd5] bg-white hover:bg-[#f0f2eb]", ghost: "hover:bg-[#eaede5]", danger: "bg-[#f6e8e4] text-[#a0412d] hover:bg-[#f1d8d1]" } }, defaultVariants: { variant: "default" } });
export function Button({ className, variant, asChild, ...props }: ComponentProps<"button"> & VariantProps<typeof styles> & { asChild?: boolean }) { const Comp = asChild ? Slot : "button"; return <Comp className={cn(styles({ variant }), className)} {...props} />; }

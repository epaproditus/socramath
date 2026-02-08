"use client";

import { ComponentPropsWithRef, forwardRef } from "react";
import { Slottable } from "@radix-ui/react-slot";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, side = "bottom", className, ...rest }, ref) => {
  return (
    <Button
      variant="ghost"
      size="icon"
      {...rest}
      title={tooltip}
      data-tooltip-side={side}
      className={cn("aui-button-icon size-6 p-1", className)}
      ref={ref}
    >
      <Slottable>{children}</Slottable>
      <span className="aui-sr-only sr-only">{tooltip}</span>
    </Button>
  );
});

TooltipIconButton.displayName = "TooltipIconButton";

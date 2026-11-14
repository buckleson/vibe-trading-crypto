import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = { narrow: "max-w-6xl", wide: "max-w-[1400px]", full: "" } as const;

export function Page({ width = "wide", className, children }: {
  width?: keyof typeof WIDTHS; className?: string; children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full space-y-6 px-4 py-4 md:px-6 md:py-6", WIDTHS[width], className)}>{children}</div>;
}

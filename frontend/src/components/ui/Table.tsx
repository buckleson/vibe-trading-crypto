import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Table({ className, wrapperClassName, ...rest }: HTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", wrapperClassName)}>
      <table className={cn("w-full border-collapse text-sm", className)} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-muted/60 text-xs font-medium text-muted-foreground", className)} {...rest} />;
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border", className)} {...rest} />;
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-muted/40", className)} {...rest} />;
}

interface CellProps { align?: "left" | "right"; numeric?: boolean }

function cellClass({ align, numeric }: CellProps) {
  return cn((numeric || align === "right") ? "text-right" : "text-left", numeric && "tabular-nums");
}

export function TH({ align, numeric, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <th className={cn("px-3 py-2 font-medium", cellClass({ align, numeric }), className)} {...rest} />;
}

export function TD({ align, numeric, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return <td className={cn("px-3 py-2 text-sm", cellClass({ align, numeric }), className)} {...rest} />;
}

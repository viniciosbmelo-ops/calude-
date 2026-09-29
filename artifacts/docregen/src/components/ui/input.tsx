import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, lang, ...props }, ref) => {
    // Native date/time pickers: follow the app language (pt-BR/es → dd/mm/aaaa)
    // where the browser honours `lang`; the <html lang> is kept in sync by i18n.
    const isDateLike = type === "date" || type === "datetime-local" || type === "month";
    const effectiveLang = lang ?? (isDateLike && typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined);
    return (
      <input
        type={type}
        lang={effectiveLang}
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }

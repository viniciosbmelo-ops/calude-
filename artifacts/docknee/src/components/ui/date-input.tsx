import * as React from "react";
import { CalendarDays, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { es, ptBR } from "react-day-picker/locale";

import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  evaluateDateText,
  formatDisplayDate,
  isoToLocalDate,
  joinDateTime,
  localDateToIso,
  maskDateText,
  maskTimeText,
  normalizeIsoDate,
  normalizeTime,
  parseTimeText,
  splitDateTime,
  type DateTextStatus,
} from "@/lib/date-input";

/*
 * DD/MM/AAAA date field that looks the same in every browser locale (a native
 * <input type="date"> follows the *browser* language, e.g. mm/dd/yyyy on an
 * English browser). Value contract is unchanged: `YYYY-MM-DD` in and out, ""
 * when empty/incomplete/invalid — nothing is ever filled with "today".
 */

type AppLocale = "pt-BR" | "es";

const TEXT: Record<AppLocale, Record<"placeholder" | "open" | "invalid" | "beforeMin" | "afterMax" | "timePlaceholder" | "invalidTime", string>> = {
  "pt-BR": {
    placeholder: "DD/MM/AAAA",
    open: "Abrir calendário",
    invalid: "Data inválida",
    beforeMin: "Data anterior a {d}",
    afterMax: "Data posterior a {d}",
    timePlaceholder: "HH:MM",
    invalidTime: "Horário inválido (00:00–23:59)",
  },
  es: {
    placeholder: "DD/MM/AAAA",
    open: "Abrir calendario",
    invalid: "Fecha inválida",
    beforeMin: "Fecha anterior a {d}",
    afterMax: "Fecha posterior a {d}",
    timePlaceholder: "HH:MM",
    invalidTime: "Hora inválida (00:00–23:59)",
  },
};

const BASE_INPUT_CLASS =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/40";

/** App language (pt-BR/es) without requiring a LanguageProvider (public pages, tests). */
function useAppLocale(explicit?: AppLocale): AppLocale {
  let fromContext: string | undefined;
  try {
    // useLanguage only reads a context; it throws when there is no provider.
    fromContext = useLanguage().locale;
  } catch {
    fromContext = undefined;
  }
  const raw = explicit ?? fromContext ?? (typeof document !== "undefined" ? document.documentElement.lang : "") ?? "";
  return raw.toLowerCase().startsWith("es") ? "es" : "pt-BR";
}

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "min" | "max" | "lang"> {
  /** `YYYY-MM-DD` or "" (controlled). */
  value?: string | null;
  /** `YYYY-MM-DD` initial value (uncontrolled; submit via `name`). */
  defaultValue?: string | null;
  /** Receives `YYYY-MM-DD`, or "" while the field is empty/incomplete/invalid. */
  onValueChange?: (value: string) => void;
  /** Inclusive bounds, `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  /** Override the app language (defaults to the LanguageProvider / <html lang>). */
  locale?: AppLocale;
  /** Classes for the outer wrapper (width/layout). `className` styles the text field. */
  wrapperClassName?: string;
  /** Hide the inline error message (aria-invalid is still set). */
  hideError?: boolean;
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  {
    value,
    defaultValue,
    onValueChange,
    min,
    max,
    locale: localeProp,
    className,
    wrapperClassName,
    hideError,
    disabled,
    readOnly,
    required,
    name,
    id: idProp,
    placeholder,
    onBlur,
    onKeyDown,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalidProp,
    ...rest
  },
  forwardedRef,
) {
  const locale = useAppLocale(localeProp);
  const text = TEXT[locale];
  const autoId = React.useId();
  const id = idProp ?? `date-${autoId}`;
  const errorId = `${id}-error`;

  const isControlled = value !== undefined;
  const [internalIso, setInternalIso] = React.useState(() => normalizeIsoDate(defaultValue));
  const currentIso = isControlled ? normalizeIsoDate(value) : internalIso;

  const [display, setDisplay] = React.useState(() => formatDisplayDate(currentIso));
  const [touched, setTouched] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const lastEmitted = React.useRef(currentIso);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // External value changes (reset, load from API) replace the typed text.
  React.useEffect(() => {
    if (currentIso !== lastEmitted.current) {
      lastEmitted.current = currentIso;
      setDisplay(formatDisplayDate(currentIso));
      setTouched(false);
    }
  }, [currentIso]);

  const evaluation = evaluateDateText(display, min, max);
  const status: DateTextStatus = evaluation.status;
  const showError =
    status === "invalid" || status === "before-min" || status === "after-max" || (touched && status === "partial");
  const errorText =
    status === "before-min"
      ? text.beforeMin.replace("{d}", formatDisplayDate(min))
      : status === "after-max"
        ? text.afterMax.replace("{d}", formatDisplayDate(max))
        : text.invalid;

  // Native form validation (required + our calendar rules).
  React.useEffect(() => {
    inputRef.current?.setCustomValidity(showError ? errorText : "");
  }, [showError, errorText]);

  const emit = (iso: string) => {
    if (iso === lastEmitted.current) return;
    lastEmitted.current = iso;
    if (!isControlled) setInternalIso(iso);
    onValueChange?.(iso);
  };

  const applyText = (raw: string) => {
    const masked = maskDateText(raw);
    setDisplay(masked);
    const res = evaluateDateText(masked, min, max);
    emit(res.status === "valid" ? res.iso : "");
  };

  const selected = isoToLocalDate(currentIso);
  const minDate = isoToLocalDate(min);
  const maxDate = isoToLocalDate(max);
  const [month, setMonth] = React.useState<Date>(() => selected ?? new Date());
  React.useEffect(() => {
    if (open) setMonth(selected ?? (maxDate && maxDate < new Date() ? maxDate : minDate && minDate > new Date() ? minDate : new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const thisYear = new Date().getFullYear();
  const startMonth = minDate ?? new Date(1900, 0, 1);
  const endMonth = maxDate ?? new Date(thisYear + 10, 11, 31);
  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  const describedBy = [ariaDescribedBy, showError && !hideError ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("w-full", wrapperClassName)} data-slot="date-input">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <input
              {...rest}
              ref={setRefs}
              id={id}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              placeholder={placeholder ?? text.placeholder}
              value={display}
              disabled={disabled}
              readOnly={readOnly}
              required={required}
              aria-invalid={showError || ariaInvalidProp === true || ariaInvalidProp === "true" ? true : undefined}
              aria-describedby={describedBy}
              className={cn(BASE_INPUT_CLASS, "pr-9 tabular-nums", className)}
              onChange={(e) => applyText(e.target.value)}
              onBlur={(e) => {
                setTouched(true);
                onBlur?.(e);
              }}
              onKeyDown={(e) => {
                if ((e.altKey && e.key === "ArrowDown") || (e.key === "ArrowDown" && !display)) {
                  e.preventDefault();
                  if (!disabled && !readOnly) setOpen(true);
                }
                onKeyDown?.(e);
              }}
            />
            {name ? <input type="hidden" name={name} value={currentIso} /> : null}
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled || readOnly}
                aria-label={text.open}
                aria-haspopup="dialog"
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
              </button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-auto p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DayPicker
            mode="single"
            locale={locale === "es" ? es : ptBR}
            weekStartsOn={0}
            autoFocus
            captionLayout="dropdown"
            showOutsideDays
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            startMonth={startMonth}
            endMonth={endMonth}
            disabled={disabledDays.length ? disabledDays : undefined}
            onSelect={(date) => {
              if (!date) return;
              const iso = localDateToIso(date);
              setDisplay(formatDisplayDate(iso));
              setTouched(false);
              emit(evaluateDateText(formatDisplayDate(iso), min, max).status === "valid" ? iso : "");
              setOpen(false);
            }}
            className="p-3"
            classNames={{
              months: "relative flex flex-col",
              month: "flex flex-col gap-3",
              nav: "absolute inset-x-0 top-0 flex items-center justify-between",
              button_previous:
                "inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              button_next:
                "inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              month_caption: "flex h-8 items-center justify-center px-8",
              caption_label: "flex items-center gap-1 text-sm font-medium capitalize [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-muted-foreground",
              dropdowns: "flex items-center gap-2",
              dropdown_root:
                "relative rounded-md border border-input px-2 py-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              dropdown: "absolute inset-0 w-full cursor-pointer opacity-0",
              month_grid: "w-full border-collapse",
              weekdays: "flex",
              weekday: "w-9 text-center text-[0.75rem] font-normal text-muted-foreground capitalize",
              week: "mt-1 flex w-full",
              day: "h-9 w-9 p-0 text-center text-sm",
              day_button:
                "inline-flex h-9 w-9 items-center justify-center rounded-md font-normal hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
              today: "[&>button]:font-semibold [&>button]:underline [&>button]:underline-offset-4",
              outside: "text-muted-foreground opacity-50",
              disabled: "pointer-events-none text-muted-foreground opacity-40",
              hidden: "invisible",
            }}
            components={{
              Chevron: ({ orientation, className: chevronClass }) =>
                orientation === "left" ? (
                  <ChevronLeftIcon className={cn("h-4 w-4", chevronClass)} />
                ) : orientation === "right" ? (
                  <ChevronRightIcon className={cn("h-4 w-4", chevronClass)} />
                ) : (
                  <ChevronDownIcon className={cn("h-3.5 w-3.5", chevronClass)} />
                ),
            }}
          />
        </PopoverContent>
      </Popover>
      {showError && !hideError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {errorText}
        </p>
      ) : null}
    </div>
  );
});

// ------------------------------------------------------------------ TimeInput

export interface TimeInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "lang"> {
  /** `HH:MM` (24h) or "". */
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  locale?: AppLocale;
  wrapperClassName?: string;
  hideError?: boolean;
}

/** 24h HH:MM field (a native time input shows AM/PM on English browsers). */
export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(function TimeInput(
  { value, defaultValue, onValueChange, locale: localeProp, className, wrapperClassName, hideError, name, id: idProp, placeholder, onBlur, "aria-describedby": ariaDescribedBy, ...rest },
  forwardedRef,
) {
  const locale = useAppLocale(localeProp);
  const text = TEXT[locale];
  const autoId = React.useId();
  const id = idProp ?? `time-${autoId}`;
  const errorId = `${id}-error`;
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(() => normalizeTime(defaultValue));
  const current = isControlled ? normalizeTime(value) : internal;
  const [display, setDisplay] = React.useState(current);
  const [touched, setTouched] = React.useState(false);
  const lastEmitted = React.useRef(current);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (current !== lastEmitted.current) {
      lastEmitted.current = current;
      setDisplay(current);
      setTouched(false);
    }
  }, [current]);

  const digits = display.replace(/\D/g, "");
  const complete = digits.length === 4;
  const valid = complete ? parseTimeText(display) !== null : true;
  const prefixBad = digits.length >= 2 && Number(digits.slice(0, 2)) > 23;
  const showError = (complete && !valid) || prefixBad || (touched && digits.length > 0 && !complete);

  React.useEffect(() => {
    inputRef.current?.setCustomValidity(showError ? text.invalidTime : "");
  }, [showError, text.invalidTime]);

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  return (
    <div className={cn("w-full", wrapperClassName)} data-slot="time-input">
      <input
        {...rest}
        ref={setRefs}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder={placeholder ?? text.timePlaceholder}
        value={display}
        aria-invalid={showError ? true : undefined}
        aria-describedby={[ariaDescribedBy, showError && !hideError ? errorId : undefined].filter(Boolean).join(" ") || undefined}
        className={cn(BASE_INPUT_CLASS, "tabular-nums", className)}
        onChange={(e) => {
          const masked = maskTimeText(e.target.value);
          setDisplay(masked);
          const next = parseTimeText(masked) ?? "";
          if (next !== lastEmitted.current) {
            lastEmitted.current = next;
            if (!isControlled) setInternal(next);
            onValueChange?.(next);
          }
        }}
        onBlur={(e) => {
          setTouched(true);
          onBlur?.(e);
        }}
      />
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {showError && !hideError ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {text.invalidTime}
        </p>
      ) : null}
    </div>
  );
});

// -------------------------------------------------------------- DateTimeInput

export interface DateTimeInputProps {
  /** datetime-local style `YYYY-MM-DDTHH:MM`, or "". */
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  locale?: AppLocale;
  className?: string;
  "aria-label"?: string;
}

/** Replacement for <input type="datetime-local">: DateInput + 24h TimeInput, same value contract. */
export function DateTimeInput({ value, defaultValue, onValueChange, name, id, disabled, required, locale, className, "aria-label": ariaLabel }: DateTimeInputProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState(() => splitDateTime(defaultValue));
  const parts = isControlled ? splitDateTime(value) : internal;
  // Keep a time typed before the date exists.
  const [pendingTime, setPendingTime] = React.useState(parts.time);
  const time = parts.date ? parts.time : pendingTime;

  const update = (date: string, t: string) => {
    setPendingTime(t);
    if (!isControlled) setInternal({ date, time: t });
    onValueChange?.(joinDateTime(date, t));
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <DateInput
        id={id}
        locale={locale}
        value={parts.date}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        wrapperClassName="flex-1 min-w-0"
        onValueChange={(d) => update(d, time)}
      />
      <TimeInput
        locale={locale}
        value={time}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} (HH:MM)` : "HH:MM"}
        wrapperClassName="w-24 shrink-0"
        onValueChange={(t) => update(parts.date, t)}
      />
      {name ? <input type="hidden" name={name} value={joinDateTime(parts.date, time)} /> : null}
    </div>
  );
}

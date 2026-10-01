"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./compact-checkout-adjustments.module.css";

type DiscountType = "fixed_amount" | "percentage";
type Adjustment = "discount" | "tip";

type Props = {
  disabled: boolean;
  discountInput: string;
  discountType: DiscountType;
  tipInput: string;
  tipSuggestions: number[];
  onApply: (mode: Adjustment, value: string, discountType: DiscountType) => void;
};

function AdjustmentIcon({ mode }: { mode: Adjustment }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {mode === "discount" ? <><path d="m7 17 10-10" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></> : <><path d="M20.8 4.6a5.3 5.3 0 0 0-7.5 0L12 5.9l-1.3-1.3a5.3 5.3 0 0 0-7.5 7.5L12 21l8.8-8.9a5.3 5.3 0 0 0 0-7.5Z" /></>}
    </svg>
  );
}

function AdjustmentDialog({ mode, onClose, ...props }: Props & { mode: Adjustment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(mode === "tip" ? props.tipInput : props.discountInput);
  const [discountType, setDiscountType] = useState(props.discountType);
  const title = mode === "tip" ? "Tip" : "Discount";
  const isPercentage = mode === "discount" && discountType === "percentage";
  const amount = Number(value || 0);
  const error = !Number.isFinite(amount) || amount < 0
    ? "Enter an amount of zero or greater."
    : isPercentage && amount > 100 ? "Discount cannot exceed 100%." : "";

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    input.current?.select();
    return () => element?.close();
  }, []);

  function typeKey(key: string) {
    const start = input.current?.selectionStart ?? value.length;
    const end = input.current?.selectionEnd ?? start;
    const from = key === "Backspace" && start === end ? Math.max(0, start - 1) : start;
    const next = value.slice(0, from) + (key === "Backspace" ? "" : key) + value.slice(end);
    if (!/^\d*(?:\.\d{0,2})?$/.test(next)) return;
    setValue(next);
    requestAnimationFrame(() => {
      input.current?.focus();
      const caret = from + (key === "Backspace" ? 0 : key.length);
      input.current?.setSelectionRange(caret, caret);
    });
  }

  return createPortal(
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={onClose} onClose={onClose} data-touch-keyboard="off">
      <form onSubmit={event => {
        event.preventDefault();
        if (error || props.disabled) return;
        props.onApply(mode, amount === 0 ? "" : String(amount), discountType);
        onClose();
      }}>
        <header className={styles.heading}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</button>
        </header>
        <div className={styles.body}>
          {mode === "discount" && <div className={styles.types} role="group" aria-label="Discount type">
            <button type="button" aria-pressed={!isPercentage} onClick={() => setDiscountType("fixed_amount")}>$ Amount</button>
            <button type="button" aria-pressed={isPercentage} onClick={() => setDiscountType("percentage")}>% Percent</button>
          </div>}
          <label htmlFor={inputId}>{isPercentage ? "Discount percent" : `${title} amount`}</label>
          <div className={styles.input}>
            <span aria-hidden="true">{isPercentage ? "%" : "$"}</span>
            <input ref={input} id={inputId} value={value} placeholder="0" inputMode="decimal" autoComplete="off" aria-invalid={!!error} aria-describedby={error ? errorId : undefined} disabled={props.disabled} onChange={event => setValue(event.target.value)} />
          </div>
          {error && <p className={styles.error} id={errorId} role="alert">{error}</p>}
          {mode === "tip" && <div className={styles.suggestions}>
            {props.tipSuggestions.map((suggestion, index) => <button type="button" key={`${suggestion}-${index}`} onClick={() => setValue(String(suggestion))}>${suggestion}</button>)}
          </div>}
          <div className={styles.keypad} onPointerDown={event => { if ((event.target as HTMLElement).closest("button")) event.preventDefault(); }}>
            {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "Backspace"].map(key => <button type="button" key={key} aria-label={key === "Backspace" ? "Backspace" : undefined} disabled={props.disabled} onClick={() => typeKey(key)}>{key === "Backspace" ? "⌫" : key}</button>)}
          </div>
          <button type="button" className={styles.clear} disabled={props.disabled} onClick={() => { setValue(""); input.current?.focus(); }}>Clear</button>
        </div>
        <footer className={styles.actions}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!!error || props.disabled}>Apply</button>
        </footer>
      </form>
    </dialog>, document.body,
  );
}

export function CompactCheckoutAdjustments(props: Props) {
  const [mode, setMode] = useState<Adjustment | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function close() {
    setMode(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  return <>
    <div className={styles.shortcuts} data-pos-compact-adjustments>
      {(["discount", "tip"] as const).map(kind => {
        const raw = kind === "discount" ? props.discountInput : props.tipInput;
        const value = Number(raw || 0);
        const label = kind === "discount" ? "Discount" : "Tip";
        const summary = value > 0 ? (kind === "discount" && props.discountType === "percentage" ? `${value}%` : `$${value.toFixed(2)}`) : "";
        return <button key={kind} type="button" aria-label={summary ? `${label}: ${summary}` : label} aria-haspopup="dialog" title={label} disabled={props.disabled} data-active={value > 0} onClick={event => { trigger.current = event.currentTarget; setMode(kind); }}>
          <AdjustmentIcon mode={kind} />
          {summary && <span>{summary}</span>}
        </button>;
      })}
    </div>
    {mode && <AdjustmentDialog {...props} mode={mode} onClose={close} />}
  </>;
}

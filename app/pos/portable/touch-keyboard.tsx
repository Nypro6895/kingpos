"use client";
import { usePortableWorkspaceState } from "./portable-workspace-state";
import { desktopDevice } from "@/lib/portable-device-storage";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./touch-keyboard.module.css";

type Editor = HTMLInputElement | HTMLTextAreaElement;
const supported = new Set(["text", "search", "email", "tel", "password", "url", "number", "date", "time", "datetime-local"]);

export function PortableTouchKeyboard({ enabled: initialEnabled, scopeSelector = "[data-portable-shell]", desktopOnly = false }: { enabled: boolean; scopeSelector?: string; desktopOnly?: boolean }) {
  const workspace=usePortableWorkspaceState();
  const enabled=typeof workspace?.settings?.touch_keyboard_enabled==='boolean'?workspace.settings.touch_keyboard_enabled:initialEnabled;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [dateValue, setDateValue] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || (desktopOnly && !desktopDevice())) return;
    function focus(event: FocusEvent) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (!target.closest(scopeSelector) || target.disabled || target.readOnly || target.closest('[data-touch-keyboard="off"]')) return;
      if (target instanceof HTMLInputElement && !supported.has(target.type)) return;
      setEditor(target);
      setDateValue(target.value);
      // The active field uses inputmode="none" to suppress the native keyboard.
      // Its subsequent click must preserve the layout selected on focus.
      if (target.inputMode !== "none") {
        setSymbols(target instanceof HTMLInputElement && (["tel", "number"].includes(target.type) || target.inputMode === "numeric"));
      }
    }
    function outside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!panel.current?.contains(target) && !target.closest('[data-touch-keyboard-keep]') && !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) setEditor(null);
    }
    document.addEventListener("focusin", focus);
    // Clicking an already focused field should reopen a dismissed keyboard.
    const click = (event: MouseEvent) => focus(event as unknown as FocusEvent);
    document.addEventListener("click", click);
    // Wait for the click to commit before collapsing the keyboard; otherwise
    // bottom-anchored actions can move away between pointerdown and pointerup.
    document.addEventListener("click", outside);
    const dismiss = () => setEditor(null);
    document.addEventListener("kingpos:hide-touch-keyboard", dismiss);
    return () => {
      document.removeEventListener("focusin", focus);
      document.removeEventListener("click", click);
      document.removeEventListener("click", outside);
      document.removeEventListener("kingpos:hide-touch-keyboard", dismiss);
    };
  }, [enabled, scopeSelector, desktopOnly]);

  useEffect(() => {
    if (!enabled || !editor) return;
    const shell = editor.closest<HTMLElement>(scopeSelector);
    const oldPadding = shell?.style.paddingBottom ?? "";
    const oldInputMode = editor.getAttribute("inputmode");
    editor.setAttribute("inputmode", "none");
    const resize = () => {
      if (shell) shell.style.paddingBottom = `${panel.current?.offsetHeight ?? 240}px`;
      document.documentElement.style.setProperty("--portable-keyboard-height", `${panel.current?.offsetHeight ?? 240}px`);
      editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const observer = new ResizeObserver(resize);
    if (panel.current) observer.observe(panel.current);
    const disconnect = new MutationObserver(() => {
      if (!editor.isConnected || editor.closest("[hidden], [inert]")) setEditor(null);
    });
    disconnect.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "inert"] });
    return () => {
      observer.disconnect(); disconnect.disconnect();
      if (oldInputMode === null) editor.removeAttribute("inputmode"); else editor.setAttribute("inputmode", oldInputMode);
      if (shell) shell.style.paddingBottom = oldPadding;
      document.documentElement.style.removeProperty("--portable-keyboard-height");
    };
  }, [editor, enabled, scopeSelector]);

  function insert(text: string, erase = false) {
    if (!editor || !editor.isConnected) return;
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    const previous = Array.from(editor.value.slice(0, start));
    const from = erase && start === end ? start - (previous.at(-1)?.length ?? 0) : start;
    const value = editor.value.slice(0, from) + text + editor.value.slice(end);
    if (!erase && editor.maxLength >= 0 && value.length > editor.maxLength) return;
    const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(editor, value);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    editor.focus({ preventScroll: true });
    if (editor.type !== "number") {
      try { editor.setSelectionRange(from + text.length, from + text.length); } catch { /* Non-text input. */ }
    }
  }

  if (!enabled || !editor) return null;
  const dateEditor = editor instanceof HTMLInputElement && ["date", "time", "datetime-local"].includes(editor.type);
  function setDate(text: string) {
    if (!editor) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    setDateValue(text);
  }
  const rows = symbols ? ["1234567890", "@#$%&*()-+", "_/:;!?.,'", "\"=<>[]{}\\|^~`"] : ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  return createPortal(<div ref={panel} className={styles.keyboard} role="group" aria-label="Touch keyboard" onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) event.preventDefault(); }}>
    <div className={styles.top}><span>{editor.getAttribute("aria-label") || editor.placeholder || "Touch keyboard"}</span><button type="button" onClick={() => setEditor(null)}>Hide keyboard</button></div>
    {dateEditor ? <div className={styles.row}>
      {editor.type !== "time" && <label>Date <input aria-label="Touch date" type="date" min={editor.min.slice(0,10)} max={editor.max.slice(0,10)} value={dateValue.slice(0,10)} onChange={event => setDate(editor.type === "date" ? event.target.value : `${event.target.value}T${dateValue.slice(11,16) || "09:00"}`)} /></label>}
      {editor.type !== "date" && <label>Time <select aria-label="Touch time" value={editor.type === "time" ? dateValue : dateValue.slice(11,16)} onChange={event => setDate(editor.type === "time" ? event.target.value : `${dateValue.slice(0,10)}T${event.target.value}`)}>{Array.from({length:96}, (_,i) => {const time = `${String(Math.floor(i/4)).padStart(2,"0")}:${String(i%4*15).padStart(2,"0")}`; return <option key={time}>{time}</option>;})}</select></label>}
    </div> : <>{rows.map((row, index) => <div className={styles.row} key={index}>{Array.from(row).map((letter) => <button type="button" key={letter} onClick={() => insert(shift ? letter.toUpperCase() : letter)}>{shift ? letter.toUpperCase() : letter}</button>)}{index === 0 && <button type="button" aria-label="Backspace" onClick={() => insert("", true)}>⌫</button>}</div>)}
    <div className={styles.row}>
      <button type="button" aria-pressed={shift} onClick={() => setShift(!shift)}>Shift</button>
      <button type="button" onClick={() => setSymbols(!symbols)}>{symbols ? "ABC" : "123 / @"}</button>
      <button type="button" className={styles.space} onClick={() => insert(" ")}>Space</button>
      {editor instanceof HTMLTextAreaElement && <button type="button" onClick={() => insert("\n")}>New line</button>}
      <button type="button" onClick={() => setEditor(null)}>Done</button>
    </div></>}
  </div>, document.body);
}

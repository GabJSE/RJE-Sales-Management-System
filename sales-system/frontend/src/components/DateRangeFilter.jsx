import { useSettings } from "../context/SettingsContext.jsx";
import { displayCalendarDate } from "../utils/settingsPresentation.js";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

const pad = value => String(value).padStart(2, "0");
export const localDateValue = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseLocal = value => { const [year, month, day] = String(value || "").split("-").map(Number); return year && month && day ? new Date(year, month - 1, day) : null; };
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const sameDay = (left, right) => left && right && localDateValue(left) === localDateValue(right);
const today = () => { const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date()); const get = key => Number(parts.find(part => part.type === key).value); return new Date(get("year"), get("month") - 1, get("day")); };

export function dateRangeForPreset(preset, now = today()) {
  let from = now; let to = now;
  if (preset === "yesterday") from = to = addDays(now, -1);
  if (preset === "last7") from = addDays(now, -6);
  if (preset === "last30") from = addDays(now, -29);
  if (preset === "thisMonth") from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (preset === "lastMonth") { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
  return { from: localDateValue(from), to: localDateValue(to), preset };
}

const presets = [["today", "Today"], ["yesterday", "Yesterday"], ["last7", "Last 7 Days"], ["last30", "Last 30 Days"], ["thisMonth", "This Month"], ["lastMonth", "Last Month"]];
const inferPreset = (range, resolve = dateRangeForPreset) => presets.find(([key]) => { const expected = resolve(key); return expected.from === range.from && expected.to === range.to; })?.[0] || "custom";

function CalendarMonth({ month, range, onSelect, todayValue }) {
  const year = month.getFullYear(); const monthIndex = month.getMonth(); const first = new Date(year, monthIndex, 1); const startOffset = first.getDay(); const count = new Date(year, monthIndex + 1, 0).getDate(); const previousCount = new Date(year, monthIndex, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => index < startOffset ? new Date(year, monthIndex - 1, previousCount - startOffset + index + 1) : index >= startOffset + count ? new Date(year, monthIndex + 1, index - startOffset - count + 1) : new Date(year, monthIndex, index - startOffset + 1));
  const from = parseLocal(range.from); const to = parseLocal(range.to); const current = parseLocal(todayValue) || today();
  return <div className="drf-calendar"><div className="drf-weekdays" aria-hidden="true">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(day => <span key={day}>{day}</span>)}</div><div className="drf-days">{cells.map(date => { const value = localDateValue(date); const selectedStart = sameDay(date, from); const selectedEnd = sameDay(date, to); const inRange = from && to && date > from && date < to; return <button type="button" key={value} className={`${date.getMonth() !== monthIndex ? "outside " : ""}${inRange ? "in-range " : ""}${selectedStart ? "range-start " : ""}${selectedEnd ? "range-end " : ""}${sameDay(date,current) ? "today" : ""}`} aria-label={date.toLocaleDateString(undefined,{dateStyle:"full"})} aria-pressed={selectedStart || selectedEnd} onClick={() => onSelect(date)}>{date.getDate()}</button>; })}</div></div>;
}

export default function DateRangeFilter({ value, onApply, label = "Date range", disabled = false, className = "", syncUrlKeys, resetPreset = "today", presetRange = dateRangeForPreset }) {
  const { settings } = useSettings(); const formatDisplay = value => displayCalendarDate(value, settings.dateFormat);
  const id = useId(); const root = useRef(null); const initial = value?.from && value?.to ? value : presetRange("today");
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState(initial); const [activePreset, setActivePreset] = useState(() => inferPreset(initial, presetRange)); const [month, setMonth] = useState(() => parseLocal(initial.from) || today());
  useEffect(() => { if (!open && value?.from && value?.to) { setDraft(value); setActivePreset(inferPreset(value, presetRange)); } }, [value?.from, value?.to, open]);
  useEffect(() => { if (!open) return; const close = event => { if (event.key === "Escape") setOpen(false); if (event.type === "mousedown" && !root.current?.contains(event.target)) setOpen(false); }; document.addEventListener("keydown", close); document.addEventListener("mousedown", close); return () => { document.removeEventListener("keydown", close); document.removeEventListener("mousedown", close); }; }, [open]);
  const display = useMemo(() => `${formatDisplay(value?.from || initial.from)} – ${formatDisplay(value?.to || initial.to)}`, [value?.from, value?.to, settings.dateFormat]);
  const commit = (next, close = true) => { onApply({ from: next.from, to: next.to, preset: next.preset || inferPreset(next, presetRange) }); if (syncUrlKeys) { const url = new URL(window.location.href); url.searchParams.set(syncUrlKeys.from, next.from); url.searchParams.set(syncUrlKeys.to, next.to); window.history.replaceState({}, "", `${url.pathname}?${url.searchParams}${url.hash}`); } if (close) setOpen(false); };
  const choosePreset = key => { const next = presetRange(key); setDraft(next); setActivePreset(key); setMonth(parseLocal(next.from)); commit(next); };
  const selectDate = date => { const selected = localDateValue(date); if (!draft.from || draft.to) { setDraft({ from: selected, to: "" }); } else if (selected < draft.from) { setDraft({ from: selected, to: draft.from }); } else { setDraft({ from: draft.from, to: selected }); } setActivePreset("custom"); };
  const reset = () => { const next = presetRange(resetPreset); setDraft(next); setActivePreset(resetPreset); setMonth(parseLocal(next.from)); commit(next); };
  return <div className={`date-range-filter ${className}`} ref={root}><label id={`${id}-label`}>{label}</label><button type="button" className="drf-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setDraft(value?.from && value?.to ? value : initial); setMonth(parseLocal(value?.from || initial.from)); setOpen(current => !current); }}><CalendarDays size={18}/><span id={`${id}-value`}>{display}</span></button>{open && <div className="drf-popover" role="dialog" aria-modal="false" aria-labelledby={`${id}-dialog-title`}><div className="drf-presets"><strong id={`${id}-dialog-title`}>Quick range</strong>{presets.map(([key,text]) => <button type="button" key={key} className={activePreset === key ? "active" : ""} onClick={() => choosePreset(key)}>{text}</button>)}<button type="button" className={activePreset === "custom" ? "active" : ""} onClick={() => setActivePreset("custom")}>Custom Range</button></div><div className="drf-picker"><header><button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18}/></button><strong>{month.toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18}/></button></header><CalendarMonth month={month} range={draft} onSelect={selectDate} todayValue={presetRange("today").from}/><div className="drf-selection"><span><small>Start</small>{formatDisplay(draft.from)}</span><span><small>End</small>{draft.to ? formatDisplay(draft.to) : "Select end date"}</span></div><footer><button type="button" className="drf-reset" onClick={reset}><X size={15}/>Reset</button><button type="button" className="drf-apply" disabled={!draft.from || !draft.to} onClick={() => commit({ ...draft, preset: "custom" })}>Apply</button></footer></div></div>}</div>;
}

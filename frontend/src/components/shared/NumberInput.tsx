import { useState } from "react";

interface Props {
  id?: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  fallback: number; // used when the field is left empty or unparseable
  step?: number;
  className?: string;
}

// Number field that keeps the raw text while typing and only parses and clamps
// on blur, so clearing it or typing a partial value doesn't snap to a default.
export function NumberInput({ id, value, onChange, min, max, fallback, step, className }: Props) {
  const [text, setText] = useState(String(value));
  // Follow outside changes to the value (e.g. picking a model sets its context window)
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }

  const commit = () => {
    const parsed = parseInt(text, 10);
    const n = Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(min, parsed));
    setText(String(n));
    setShown(n);
    if (n !== value) onChange(n);
  };

  return (
    <input
      id={id}
      type="number"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      min={min}
      max={max}
      step={step}
      className={className}
    />
  );
}

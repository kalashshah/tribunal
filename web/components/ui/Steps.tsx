/**
 * <Steps> — Roman-numeralled process list. Pass items in order; the
 * numerals are derived. Cap at 8 to stay inside a readable rhythm.
 */

import type { ReactNode } from "react";

export interface StepItem {
  title: ReactNode;
  body: ReactNode;
}

interface Props {
  items: StepItem[];
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

export function Steps({ items }: Props) {
  return (
    <ol className="steps">
      {items.map((step, i) => (
        <li key={i}>
          <span className="num">{ROMAN[i] ?? String(i + 1)}</span>
          <h4>{step.title}</h4>
          <p>{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

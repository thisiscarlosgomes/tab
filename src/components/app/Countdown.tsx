import { useEffect, useState } from "react";
import NumberFlow, { NumberFlowGroup } from "@number-flow/react";

export function Countdown({ seconds: initialSeconds }: { seconds: number }) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    setSeconds(initialSeconds); // reset countdown if props change
  }, [initialSeconds]);

  useEffect(() => {
    if (seconds <= 0) return;

    const interval = setInterval(() => {
      setSeconds((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [seconds]);

  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = Math.floor(seconds % 60);

  return (
    <NumberFlowGroup>
      <span
        className="flex items-baseline justify-center text-white text-base"
        style={{
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <NumberFlow value={hh} trend={-1} format={{ minimumIntegerDigits: 2 }} />
        <NumberFlow value={mm} trend={-1} prefix=":" format={{ minimumIntegerDigits: 2 }} />
        <NumberFlow value={ss} trend={-1} prefix=":" format={{ minimumIntegerDigits: 2 }} />
      </span>
    </NumberFlowGroup>
  );
}

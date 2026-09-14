import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
export type RevealedLineHandle = { reveal: () => boolean };
export const RevealedLine = forwardRef<
  RevealedLineHandle,
  { text: string; onComplete?: () => void; showCaret?: boolean }
>(function RevealedLine({ text, onComplete, showCaret = true }, ref) {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  useEffect(() => {
    countRef.current = 0;
    setCount(0);
    const finish = () => {
      countRef.current = text.length;
      setCount(text.length);
      callback.current?.();
    };
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !text.length
    ) {
      finish();
      return;
    }
    const timer = setInterval(() => {
      countRef.current = Math.min(text.length, countRef.current + 1);
      setCount(countRef.current);
      if (countRef.current === text.length) {
        clearInterval(timer);
        callback.current?.();
      }
    }, 28);
    return () => clearInterval(timer);
  }, [text]);
  useImperativeHandle(
    ref,
    () => ({
      reveal() {
        if (countRef.current >= text.length) return true;
        countRef.current = text.length;
        setCount(text.length);
        callback.current?.();
        return false;
      },
    }),
    [text],
  );
  return (
    <p
      className="revealed-line"
      aria-label={text}
      data-complete={count >= text.length}
    >
      <span aria-hidden="true">{text.slice(0, count)}</span>
      <span className="unrevealed" aria-hidden="true">
        {text.slice(count)}
      </span>
      {showCaret && count >= text.length && (
        <span className="line-caret" aria-hidden="true" />
      )}
    </p>
  );
});

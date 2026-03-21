import { useState, useEffect } from "react";
import { useStore } from "../../store";

type Correctness = "correct" | "partial" | "wrong" | "skipped";

const BUTTONS: {
  value: Correctness;
  label: string;
  style: React.CSSProperties;
  activeStyle: React.CSSProperties;
}[] = [
  {
    value: "correct",
    label: "Correct",
    style: { borderColor: 'var(--sub-phosphor-dim)', color: 'var(--sub-phosphor)' },
    activeStyle: { backgroundColor: 'var(--sub-phosphor-dim)', color: 'white', borderColor: 'var(--sub-phosphor-dim)' },
  },
  {
    value: "partial",
    label: "Partial",
    style: { borderColor: 'var(--sub-rivet)', color: 'var(--sub-brass)' },
    activeStyle: { backgroundColor: 'var(--sub-brass-dim)', color: 'white', borderColor: 'var(--sub-brass-dim)' },
  },
  {
    value: "wrong",
    label: "Wrong",
    style: { borderColor: 'var(--sub-rivet)', color: 'var(--sub-red)' },
    activeStyle: { backgroundColor: 'var(--sub-red-dim)', color: 'white', borderColor: 'var(--sub-red-dim)' },
  },
  {
    value: "skipped",
    label: "Skip",
    style: { borderColor: 'var(--sub-rivet)', color: 'var(--sub-text-dim)' },
    activeStyle: { backgroundColor: 'var(--sub-panel-light)', color: 'var(--sub-text)', borderColor: 'var(--sub-rivet)' },
  },
];

export function RatingPanel() {
  const evalResults = useStore((s) => s.evalResults);
  const selectedEvalIndex = useStore((s) => s.selectedEvalIndex);
  const submitRating = useStore((s) => s.submitRating);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<Correctness | null>(null);

  const evalResult = selectedEvalIndex !== null ? evalResults[selectedEvalIndex] : null;
  const existingRating = evalResult?.rating;
  const isRated = !!existingRating;

  // Reset local state when selection changes
  useEffect(() => {
    setNotes("");
    setPending(null);
  }, [selectedEvalIndex]);

  if (selectedEvalIndex === null || !evalResult) {
    return null;
  }

  const handleRate = async (correctness: Correctness) => {
    if (isRated) return;

    if (correctness === "partial" || correctness === "wrong") {
      if (pending === correctness) {
        // Second click -- submit with notes
        await submitRating(selectedEvalIndex, correctness, notes);
        setPending(null);
        setNotes("");
      } else {
        // First click -- show notes field
        setPending(correctness);
        setNotes("");
      }
    } else {
      // Correct/Skip -- submit immediately
      await submitRating(selectedEvalIndex, correctness, "");
      setPending(null);
      setNotes("");
    }
  };

  // Compute accuracy stats
  const rated = evalResults.filter((e) => e.rating);
  const correct = rated.filter((e) => e.rating?.correctness === "correct").length;
  const partial = rated.filter((e) => e.rating?.correctness === "partial").length;
  const wrong = rated.filter((e) => e.rating?.correctness === "wrong").length;
  const totalScored = correct + partial + wrong;
  const accuracy = totalScored > 0 ? (correct + 0.5 * partial) / totalScored : 0;

  return (
    <div className="p-4" style={{ borderTop: '1px solid var(--sub-rivet)' }}>
      {/* Rating buttons */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs mr-1" style={{ color: 'var(--sub-text-dim)' }}>Rate:</span>
        {BUTTONS.map((btn) => {
          const isActive = existingRating?.correctness === btn.value;
          return (
            <button
              key={btn.value}
              onClick={() => handleRate(btn.value)}
              disabled={isRated}
              className={`px-3 py-1 text-sm rounded-lg border transition-colors disabled:opacity-60 ${
                isRated && !isActive ? "opacity-30" : ""
              }`}
              style={isActive ? btn.activeStyle : btn.style}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* Notes input for partial/wrong */}
      {pending && !isRated && (
        <div className="mb-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`What was ${pending === "partial" ? "missing or incomplete" : "wrong"}?`}
            rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm input-sub border focus:outline-none resize-none"
          />
          <button
            onClick={() => handleRate(pending)}
            className="btn-brass mt-1 px-3 py-1 text-xs rounded-lg transition-colors"
          >
            Submit Rating
          </button>
        </div>
      )}

      {/* Accuracy stats */}
      {rated.length > 0 && (
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--sub-text-dim)' }}>
          <span>
            Accuracy:{" "}
            <span className="font-medium" style={{ color: 'var(--sub-text)' }}>
              {(accuracy * 100).toFixed(0)}%
            </span>
          </span>
          <span className="phosphor-text">{correct}C</span>
          <span style={{ color: 'var(--sub-brass)' }}>{partial}P</span>
          <span className="alarm-text">{wrong}W</span>
        </div>
      )}
    </div>
  );
}

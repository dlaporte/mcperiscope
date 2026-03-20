import { useState, useEffect } from "react";
import { useStore } from "../../store";

type Correctness = "correct" | "partial" | "wrong" | "skipped";

const BUTTONS: { value: Correctness; label: string; color: string; activeColor: string }[] = [
  { value: "correct", label: "Correct", color: "border-green-700 text-green-400 hover:bg-green-900/30", activeColor: "bg-green-700 text-white border-green-700" },
  { value: "partial", label: "Partial", color: "border-yellow-700 text-yellow-400 hover:bg-yellow-900/30", activeColor: "bg-yellow-700 text-white border-yellow-700" },
  { value: "wrong", label: "Wrong", color: "border-red-700 text-red-400 hover:bg-red-900/30", activeColor: "bg-red-700 text-white border-red-700" },
  { value: "skipped", label: "Skip", color: "border-gray-600 text-gray-400 hover:bg-gray-800", activeColor: "bg-gray-600 text-white border-gray-600" },
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
        // Second click — submit with notes
        await submitRating(selectedEvalIndex, correctness, notes);
        setPending(null);
        setNotes("");
      } else {
        // First click — show notes field
        setPending(correctness);
        setNotes("");
      }
    } else {
      // Correct/Skip — submit immediately
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
    <div className="border-t border-gray-700 p-4">
      {/* Rating buttons */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-400 mr-1">Rate:</span>
        {BUTTONS.map((btn) => {
          const isActive = existingRating?.correctness === btn.value;
          return (
            <button
              key={btn.value}
              onClick={() => handleRate(btn.value)}
              disabled={isRated}
              className={`px-3 py-1 text-sm rounded-lg border transition-colors disabled:opacity-60 ${
                isActive ? btn.activeColor : btn.color
              } ${isRated && !isActive ? "opacity-30" : ""}`}
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
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <button
            onClick={() => handleRate(pending)}
            className="mt-1 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Submit Rating
          </button>
        </div>
      )}

      {/* Accuracy stats */}
      {rated.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span>
            Accuracy:{" "}
            <span className="text-white font-medium">
              {(accuracy * 100).toFixed(0)}%
            </span>
          </span>
          <span className="text-green-400">{correct}C</span>
          <span className="text-yellow-400">{partial}P</span>
          <span className="text-red-400">{wrong}W</span>
        </div>
      )}
    </div>
  );
}

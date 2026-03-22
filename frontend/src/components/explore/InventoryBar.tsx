import { useStore } from "../../store";
import { MODEL_CONTEXT } from "../../config/models";
import { ContextGauge } from "./ContextGauge";

export function InventoryBar() {
  const { inventory, model, customContextWindow } = useStore();

  const totalTokens = inventory?.totalBudgetTokens ?? inventory?.total_budget_tokens ?? 0;
  const contextWindow = inventory?.contextWindow ?? MODEL_CONTEXT[model] ?? customContextWindow ?? 200_000;

  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ backgroundColor: 'var(--sub-panel)', borderBottom: '1px solid var(--sub-rivet)' }}
    >
      <span className="font-stencil text-xs whitespace-nowrap" style={{ color: 'var(--sub-text-dim)' }}>Session usage</span>
      <ContextGauge tokens={totalTokens} max={contextWindow} />
    </div>
  );
}

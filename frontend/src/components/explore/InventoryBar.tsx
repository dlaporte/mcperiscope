import { useStore, selectContextWindow } from "../../store";
import { ContextGauge } from "./ContextGauge";
import { UsageBar } from "../shared/UsageBar";

export function InventoryBar() {
  const inventory = useStore((s) => s.inventory);
  const contextWindow = useStore(selectContextWindow);

  const totalTokens = inventory?.totalBudgetTokens ?? inventory?.total_budget_tokens ?? 0;

  return (
    <UsageBar>
      <ContextGauge tokens={totalTokens} max={contextWindow} />
    </UsageBar>
  );
}

import { useStore, selectContextWindow } from "../../store";
import { ContextGauge } from "./ContextGauge";
import { UsageBar } from "../shared/UsageBar";
import { menuTokens } from "../../utils/tokens";

export function InventoryBar() {
  const inventory = useStore((s) => s.inventory);
  const contextWindow = useStore(selectContextWindow);

  const totalTokens = menuTokens(inventory);

  return (
    <UsageBar>
      <ContextGauge tokens={totalTokens} max={contextWindow} />
    </UsageBar>
  );
}

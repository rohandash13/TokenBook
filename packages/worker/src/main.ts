import { createGatewayClient } from "./gateway-client";
import { runWorker } from "./loop";
import { installNetGuard } from "./net-guard";

const { GATEWAY_URL, TASK_ID, TASK_TEXT } = process.env;
if (!GATEWAY_URL || !TASK_ID || !TASK_TEXT) {
  console.error("worker needs GATEWAY_URL, TASK_ID and TASK_TEXT");
  process.exit(2);
}

installNetGuard(GATEWAY_URL);
const result = await runWorker({ client: createGatewayClient(GATEWAY_URL), taskId: TASK_ID, taskText: TASK_TEXT });
console.log(result.finalText);
if (result.exhausted) process.exitCode = 3;

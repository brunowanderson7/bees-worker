import { createApiServer } from "../services/http-server.js";
import { Operations } from "../services/operations.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT deve ser um inteiro entre 1 e 65535.");
}
const apiKey = process.env.BEES_API_KEY;
if (!apiKey || apiKey.length < 32 || /[\r\n]/.test(apiKey)) {
  throw new Error("Defina BEES_API_KEY com pelo menos 32 caracteres, sem quebras de linha.");
}
const operations = new Operations();
const server = createApiServer({ apiKey, operations });
server.on("error", (error) => {
  console.error("Falha ao iniciar API:", error);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`API BEES: http://${host}:${port}/returns/today`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void operations.shutdown().catch(console.error);
    const deadline = Date.now() + 20_000;
    const timer = setInterval(() => {
      if (!operations.status().active) {
        clearInterval(timer); operations.close(); process.exit(0);
      } else if (Date.now() >= deadline) process.exit(0);
    }, 250);
  });
}

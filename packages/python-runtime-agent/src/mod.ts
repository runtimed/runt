async function main() {
  console.log("PythonRuntimeAgent main");
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  await delay(1000);
}

if (import.meta.main) {
  await main();
}

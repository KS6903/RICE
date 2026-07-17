export default async function globalTeardown() {
  try {
    await fetch("http://127.0.0.1:8001/__e2e_shutdown", { method: "POST" });
  } catch {
    // The server may already have exited after an early startup failure.
  }
}

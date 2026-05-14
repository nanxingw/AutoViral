// Stub — fleshed out in Task 3.11.
export async function exportCommand(_args: string[]): Promise<void> {
  process.stderr.write("autoviral export: not yet implemented\n");
  process.exit(3);
}
export async function renderCommand(args: string[]): Promise<void> {
  return exportCommand([...args, "--proxy"]);
}

export interface PluginManifest {
  id: string;
  version: string;
  displayName: string;
  apiVersion: "1";
  capabilities: readonly ("agent-backend" | "tool-executor" | "notification-sink" | "workflow-node")[];
}

export interface PlatformPlugin {
  manifest: PluginManifest;
  initialize?(context: { register: (capability: string, value: unknown) => void }): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

/** Explicit, server-owned plugin registry; plugins cannot self-authorize capabilities. */
export class PluginRegistry {
  private readonly plugins = new Map<string, PlatformPlugin>();
  private readonly capabilities = new Map<string, unknown>();
  register(plugin: PlatformPlugin) {
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(plugin.manifest.id)) throw new Error("Invalid plugin id.");
    if (plugin.manifest.apiVersion !== "1") throw new Error("Unsupported plugin API version.");
    if (this.plugins.has(plugin.manifest.id)) throw new Error(`Plugin already registered: ${plugin.manifest.id}`);
    this.plugins.set(plugin.manifest.id, plugin);
  }
  async initializeAll() {
    for (const plugin of this.plugins.values()) await plugin.initialize?.({ register: (name, value) => {
      if (!plugin.manifest.capabilities.some((capability) => name.startsWith(`${capability}:`))) throw new Error(`Plugin ${plugin.manifest.id} is not authorized to register ${name}.`);
      this.capabilities.set(`${plugin.manifest.id}:${name}`, value);
    } });
  }
  get<T>(pluginId: string, capability: string): T | undefined { return this.capabilities.get(`${pluginId}:${capability}`) as T | undefined; }
  async shutdownAll() { for (const plugin of [...this.plugins.values()].reverse()) await plugin.shutdown?.(); }
}

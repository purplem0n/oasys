/**
 * Collect system info for Terminal Agent context and TUI status bar.
 * Uses node:os (sync) and optional systeminformation (async) for rich details.
 */

import os from "node:os";

export type SystemInfo = {
  // From node:os (always available)
  platform: string;
  arch: string;
  hostname: string;
  kernelRelease: string;
  cpus: number;
  totalMemoryMB: number;
  freeMemoryMB: number;
  loadavg: [number, number, number];
  uptimeSeconds: number;
  runtime: string; // e.g. "node" or "bun"
  // Optional from systeminformation (when getExtendedSystemInfo has run)
  distro?: string;
  cpuBrand?: string;
  cpuCores?: number;
  cpuPhysicalCores?: number;
  cpuSpeedMHz?: number;
  usedMemoryMB?: number;
};

let cached: SystemInfo | null = null;

function getRuntimeName(): string {
  if (typeof process === "undefined") return "unknown";
  const r = process.release as { name?: string } | undefined;
  if (r?.name) return r.name;
  if (typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined") return "bun";
  return "node";
}

function safeOs<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Sync: populate from node:os. Always available. Resilient to sandbox restrictions. */
export function getSystemInfo(): SystemInfo {
  if (cached) return cached;
  const loadavg = safeOs(() => os.loadavg(), [0, 0, 0] as [number, number, number]);
  cached = {
    platform: safeOs(() => os.platform(), typeof process !== "undefined" ? process.platform : "unknown"),
    arch: safeOs(() => os.arch(), typeof process !== "undefined" ? process.arch : "unknown"),
    hostname: safeOs(() => os.hostname(), "localhost"),
    kernelRelease: safeOs(() => os.release(), ""),
    cpus: safeOs(() => os.cpus().length, 0),
    totalMemoryMB: safeOs(() => Math.round(os.totalmem() / 1024 / 1024), 0),
    freeMemoryMB: safeOs(() => Math.round(os.freemem() / 1024 / 1024), 0),
    loadavg: [loadavg[0] ?? 0, loadavg[1] ?? 0, loadavg[2] ?? 0],
    uptimeSeconds: safeOs(() => Math.floor(os.uptime()), 0),
    runtime: getRuntimeName(),
  };
  return cached;
}

/** Extended fields from systeminformation (CPU brand, distro, etc.). Merge into cached. */
export type ExtendedSystemInfo = {
  distro?: string;
  cpuBrand?: string;
  cpuCores?: number;
  cpuPhysicalCores?: number;
  cpuSpeedMHz?: number;
  usedMemoryMB?: number;
};

let extendedCache: ExtendedSystemInfo | null = null;

/** Async: fetch rich OS/CPU/memory info and merge into cached SystemInfo. Call once on app load. */
export async function getExtendedSystemInfo(): Promise<ExtendedSystemInfo> {
  if (extendedCache) return extendedCache;
  try {
    const si = await import("systeminformation");
    const [osInfo, cpu, mem] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.mem(),
    ]);
    const extended: ExtendedSystemInfo = {
      distro: osInfo.distro && osInfo.distro !== "unknown" ? osInfo.distro : undefined,
      cpuBrand: cpu.brand?.trim() || undefined,
      cpuCores: cpu.cores,
      cpuPhysicalCores: cpu.physicalCores,
      cpuSpeedMHz: cpu.speed,
      // Prefer "active" (app memory, excl. cache) so the bar matches Activity Monitor / user expectation
      usedMemoryMB:
        mem.active != null
          ? Math.round(mem.active / 1024 / 1024)
          : mem.used != null
            ? Math.round(mem.used / 1024 / 1024)
            : undefined,
    };
    extendedCache = extended;
    // Merge into cached so formatSystemInfoShort can use it
    const base = getSystemInfo();
    if (extended.distro != null) (base as SystemInfo).distro = extended.distro;
    if (extended.cpuBrand != null) (base as SystemInfo).cpuBrand = extended.cpuBrand;
    if (extended.cpuCores != null) (base as SystemInfo).cpuCores = extended.cpuCores;
    if (extended.cpuPhysicalCores != null) (base as SystemInfo).cpuPhysicalCores = extended.cpuPhysicalCores;
    if (extended.cpuSpeedMHz != null) (base as SystemInfo).cpuSpeedMHz = extended.cpuSpeedMHz;
    if (extended.usedMemoryMB != null) (base as SystemInfo).usedMemoryMB = extended.usedMemoryMB;
    return extended;
  } catch {
    return {};
  }
}

/** Clear caches (e.g. for tests). */
export function clearSystemInfoCache(): void {
  cached = null;
  extendedCache = null;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** One-line summary for the TUI status bar. */
export function formatSystemInfoShort(info: SystemInfo): string {
  const parts: string[] = [];

  // Host + OS
  parts.push(info.hostname);
  const osLabel = info.distro ?? info.platform;
  parts.push(osLabel);
  parts.push(info.arch);

  // CPU
  if (info.cpuBrand) {
    const cpuShort = info.cpuBrand.replace(/\s+/g, " ").slice(0, 24);
    parts.push(cpuShort);
  } else if (info.cpus) {
    parts.push(`${info.cpus} CPUs`);
  }

  // Memory (used/total or total only)
  const memUsed = info.usedMemoryMB ?? (info.totalMemoryMB - info.freeMemoryMB);
  if (memUsed != null && info.totalMemoryMB) {
    const totalGB = (info.totalMemoryMB / 1024).toFixed(1);
    parts.push(`RAM ${Math.round(memUsed / 1024 * 10) / 10} / ${totalGB} GB`);
  } else if (info.totalMemoryMB) {
    parts.push(`${info.totalMemoryMB} MB RAM`);
  }

  // Uptime
  if (info.uptimeSeconds >= 60) {
    parts.push(`up ${formatUptime(info.uptimeSeconds)}`);
  }

  parts.push(info.runtime);

  return parts.join(" · ");
}

export function formatSystemInfoJSON(info: SystemInfo): string {
  return JSON.stringify(info, null, 0);
}

/** 局域网地址探测：只返回可被同网段设备访问的 IPv4。 */
import os from 'node:os';

export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (name.startsWith('lo') || name.startsWith('bridge') || name.startsWith('utun') || name.startsWith('awdl')) continue;
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      if (!found.includes(info.address)) found.push(info.address);
    }
  }
  return found;
}

export function primaryLanAddress(): string | undefined {
  return lanAddresses()[0];
}

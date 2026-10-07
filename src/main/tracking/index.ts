import { SimulatedProvider } from '@core/demo/SimulatedProvider';
import { ProviderChain } from '@core/tracking/ProviderChain';
import type { WindowProvider } from '@core/tracking/types';
import { PowerShellProvider } from './PowerShellProvider';
import { Win32Provider } from './Win32Provider';

/** Native Win32 first, PowerShell as fallback; the simulator in demo mode. */
export function createWindowProvider(demo: boolean): WindowProvider {
  if (demo) return new SimulatedProvider();
  return new ProviderChain([() => new Win32Provider(), () => new PowerShellProvider()]);
}

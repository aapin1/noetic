import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { getUserId } from '@/lib/storage';

// Central RevenueCat access. Both SDKs are native modules: in a dev client
// built before they were added the require throws, and every helper here
// degrades to "unavailable" instead of crashing the JS bundle.
type PurchasesModule = typeof import('react-native-purchases');
type PurchasesUiModule = typeof import('react-native-purchases-ui');

let purchasesModule: PurchasesModule | null = null;
let purchasesUiModule: PurchasesUiModule | null = null;
try {
  purchasesModule = require('react-native-purchases');
} catch {
  purchasesModule = null;
}
try {
  purchasesUiModule = require('react-native-purchases-ui');
} catch {
  purchasesUiModule = null;
}

/** Must match the entitlement identifier in the RevenueCat dashboard. */
export const ENTITLEMENT_ID = 'Mneme Pro';

// Public SDK key (not a secret). The test-store key lets the whole purchase
// flow run before App Store Connect products exist; set the env var to the
// real Apple key for production builds.
const API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? 'test_xUBWxoGsfrgWpBZfsXztGlsNNfj';

let configured = false;

/** Idempotent. Identifies the user by our User.id so RevenueCat webhook
 * events map straight onto the backend's User rows. */
export async function configurePurchases(): Promise<boolean> {
  if (!purchasesModule) return false;
  if (configured) return true;
  try {
    const Purchases = purchasesModule.default;
    const userId = await getUserId();
    Purchases.configure({ apiKey: API_KEY, appUserID: userId ?? undefined });
    configured = true;
    return true;
  } catch {
    return false;
  }
}

export function isProEntitled(info: CustomerInfo | null): boolean {
  return Boolean(info?.entitlements.active[ENTITLEMENT_ID]);
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!(await configurePurchases())) return null;
  try {
    return await purchasesModule!.default.getCustomerInfo();
  } catch {
    return null;
  }
}

export async function getCurrentPackages(): Promise<PurchasesPackage[]> {
  if (!(await configurePurchases())) return [];
  try {
    const offerings = await purchasesModule!.default.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

/** Returns the post-purchase CustomerInfo, or null if cancelled. Throws on
 * real failures so callers can show the message. */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo | null> {
  if (!(await configurePurchases())) return null;
  try {
    const { customerInfo } = await purchasesModule!.default.purchasePackage(pkg);
    return customerInfo;
  } catch (err) {
    if ((err as { userCancelled?: boolean }).userCancelled) return null;
    throw err;
  }
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!(await configurePurchases())) return null;
  return purchasesModule!.default.restorePurchases();
}

/**
 * Remote-configured RevenueCat paywall. Returns true when the user ended up
 * entitled (purchased or restored), false when they dismissed it, and null
 * when no paywall could be shown (SDK missing, none configured in the
 * dashboard) — callers then fall back to the in-app package list.
 */
export async function presentPaywall(): Promise<boolean | null> {
  if (!purchasesUiModule || !(await configurePurchases())) return null;
  try {
    const RevenueCatUI = purchasesUiModule.default;
    const { PAYWALL_RESULT } = purchasesUiModule;
    const result = await RevenueCatUI.presentPaywall();
    if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) return true;
    if (result === PAYWALL_RESULT.CANCELLED) return false;
    return null; // NOT_PRESENTED / ERROR — no usable remote paywall
  } catch {
    return null;
  }
}

/** RevenueCat Customer Center: cancel, refund, change plan — Apple-compliant
 * subscription management without building any of it. */
export async function presentCustomerCenter(): Promise<boolean> {
  if (!purchasesUiModule || !(await configurePurchases())) return false;
  try {
    await purchasesUiModule.default.presentCustomerCenter();
    return true;
  } catch {
    return false;
  }
}

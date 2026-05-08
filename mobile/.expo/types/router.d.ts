/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string = string> extends Record<string, unknown> {
      StaticRoutes: `/` | `/(auth)` | `/(auth)/sign-in` | `/(auth)/sign-up` | `/(onboarding)` | `/(onboarding)/identity` | `/(onboarding)/preview` | `/(onboarding)/starter-links` | `/(onboarding)/topics` | `/(tabs)` | `/(tabs)/` | `/(tabs)/memory` | `/(tabs)/profile` | `/(tabs)/trends` | `/_sitemap` | `/identity` | `/memory` | `/preview` | `/profile` | `/profile/edit` | `/settings` | `/sign-in` | `/sign-up` | `/starter-links` | `/topics` | `/trends`;
      DynamicRoutes: `/insight/${Router.SingleRoutePart<T>}`;
      DynamicRouteTemplate: `/insight/[id]`;
    }
  }
}

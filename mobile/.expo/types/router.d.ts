/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string = string> extends Record<string, unknown> {
      StaticRoutes: `/` | `/(auth)` | `/(auth)/sign-in` | `/(auth)/sign-up` | `/(onboarding)` | `/(onboarding)/preferences` | `/(onboarding)/preview` | `/(onboarding)/starter-links` | `/(onboarding)/topics` | `/(tabs)` | `/(tabs)/` | `/(tabs)/notifications` | `/(tabs)/profile` | `/(tabs)/search` | `/_sitemap` | `/compose/log` | `/notifications` | `/preferences` | `/preview` | `/profile` | `/profile/edit` | `/search` | `/settings` | `/sign-in` | `/sign-up` | `/starter-links` | `/topics`;
      DynamicRoutes: `/compare/${Router.SingleRoutePart<T>}/${Router.SingleRoutePart<T>}` | `/content/${Router.SingleRoutePart<T>}` | `/profile/${Router.SingleRoutePart<T>}` | `/topics/${Router.SingleRoutePart<T>}`;
      DynamicRouteTemplate: `/compare/[handleA]/[handleB]` | `/content/[id]` | `/profile/[handle]` | `/topics/[slug]`;
    }
  }
}

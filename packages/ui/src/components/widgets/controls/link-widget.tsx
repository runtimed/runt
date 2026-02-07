"use client";

/**
 * Link widgets — frontend-only property synchronization.
 *
 * LinkModel: bidirectional sync (widgets.jslink)
 * DirectionalLinkModel: one-way sync (widgets.jsdlink)
 *
 * These are headless widgets that render no visible UI. Property
 * synchronization is handled at the store level by createLinkManager
 * (see link-subscriptions.ts), which runs automatically in the
 * WidgetStoreProvider.
 *
 * These components exist in the widget registry so that WidgetView
 * renders null instead of showing "Unsupported widget".
 */

import type { WidgetComponentProps } from "../widget-registry";

/**
 * DirectionalLinkWidget — one-way property synchronization (source → target).
 * Renders nothing. Sync logic runs at the store level.
 */
export function DirectionalLinkWidget(_props: WidgetComponentProps) {
  return null;
}

/**
 * LinkWidget — bidirectional property synchronization (source ↔ target).
 * Renders nothing. Sync logic runs at the store level.
 */
export function LinkWidget(_props: WidgetComponentProps) {
  return null;
}

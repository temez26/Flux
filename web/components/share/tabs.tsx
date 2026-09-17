import type { ComponentType } from "react";
import { DeviceIcon, GlobeIcon, TextIcon, type IconProps } from "../ui/icons";

export type TabId = "public" | "device" | "text";

/** A way to share, chosen from the tabs at the top of the home page. */
export interface ShareTab {
  id: TabId;
  path: string;
  name: string;
  /** What it does, in a few words. */
  summary: string;
  Icon: ComponentType<IconProps>;
}

export const TABS: ShareTab[] = [
  {
    id: "public",
    path: "/public",
    name: "Public",
    summary: "Files anyone on Flux can download.",
    Icon: GlobeIcon,
  },
  {
    id: "device",
    path: "/device",
    name: "Device",
    summary: "Straight to a nearby device, no upload.",
    Icon: DeviceIcon,
  },
  {
    id: "text",
    path: "/text",
    name: "Text",
    summary: "A note, link or password.",
    Icon: TextIcon,
  },
];

/** The tab an address shows; the home page itself shows the first. */
export const tabAt = (path: string) => (path === "/" ? TABS[0] : TABS.find((tab) => tab.path === path));

export const tabById = (id: TabId) => TABS.find((tab) => tab.id === id)!;

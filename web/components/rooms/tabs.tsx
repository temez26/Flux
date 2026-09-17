import type { ComponentType } from "react";
import { DeviceIcon, FolderIcon, GlobeIcon, TextIcon, type IconProps } from "../ui/icons";

export type TabId = "public" | "device" | "text" | "collect";

/** A way to share, chosen from the tabs at the top of the home page. */
export interface ShareTab {
  id: TabId;
  path: string;
  name: string;
  /** What it does, in a sentence someone new to Flux understands. */
  summary: string;
  Icon: ComponentType<IconProps>;
}

export const TABS: ShareTab[] = [
  {
    id: "public",
    path: "/public",
    name: "Public",
    summary: "Upload files that anyone who opens Flux can see and download.",
    Icon: GlobeIcon,
  },
  {
    id: "device",
    path: "/device",
    name: "Device",
    summary: "Send files straight to another device nearby. Nothing is uploaded.",
    Icon: DeviceIcon,
  },
  {
    id: "text",
    path: "/text",
    name: "Text",
    summary: "Share a note, link or password, to read or to edit together.",
    Icon: TextIcon,
  },
  {
    id: "collect",
    path: "/collect",
    name: "Collect",
    summary: "Get a link other people use to send files to you.",
    Icon: FolderIcon,
  },
];

/** The tab an address shows; the home page itself shows the first. */
export const tabAt = (path: string) => (path === "/" ? TABS[0] : TABS.find((tab) => tab.path === path));

export const tabById = (id: TabId) => TABS.find((tab) => tab.id === id)!;

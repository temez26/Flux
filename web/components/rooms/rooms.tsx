import type { ComponentType } from "react";
import { FolderIcon, GlobeIcon, LockIcon, TextIcon, type IconProps } from "../ui/icons";

export type RoomId = "private" | "public" | "text" | "collect";

export interface Room {
  id: RoomId;
  path: string;
  name: string;
  summary: string;
  Icon: ComponentType<IconProps>;
}

export const ROOMS: Room[] = [
  {
    id: "private",
    path: "/private",
    name: "Private share",
    summary: "Send files to anyone you give the code, link or QR code.",
    Icon: LockIcon,
  },
  {
    id: "public",
    path: "/public",
    name: "Public share",
    summary: "Share files everyone on Flux can see, and browse what others shared.",
    Icon: GlobeIcon,
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
    name: "Collect files",
    summary: "Get a code other people use to send files to you.",
    Icon: FolderIcon,
  },
];

export const roomAt = (path: string) => ROOMS.find((room) => room.path === path);

export const room = (id: RoomId) => ROOMS.find((r) => r.id === id)!;

/** Wide enough to show the rooms side by side on the home page instead of linking to them. */
export const WIDE_QUERY = "(min-width: 64rem)";

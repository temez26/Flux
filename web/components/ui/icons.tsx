import type { ReactNode } from "react";

type IconProps = { className?: string };

function Icon({ d, className = "size-5" }: IconProps & { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export const LogoIcon = (p: IconProps) => <Icon d="M4 7h16m-3-3 3 3-3 3M20 17H4m3-3-3 3 3 3" {...p} />;
export const UploadIcon = (p: IconProps) => (
  <Icon d="M12 15V3m0 0L7 8m5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" {...p} />
);
export const DownloadIcon = (p: IconProps) => (
  <Icon d="M12 3v12m0 0-5-5m5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" {...p} />
);
export const CloseIcon = (p: IconProps) => <Icon d="M6 6l12 12M18 6 6 18" {...p} />;
export const RetryIcon = (p: IconProps) => <Icon d="M20 12a8 8 0 1 1-2.34-5.66L20 8.7M20 4v4.7h-4.7" {...p} />;
export const CheckIcon = (p: IconProps) => <Icon d="m5 12.5 4.5 4.5L19 7" {...p} />;
export const FolderIcon = (p: IconProps) => (
  <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...p} />
);
export const ArrowIcon = (p: IconProps) => <Icon d="M5 12h14m-6-6 6 6-6 6" {...p} />;
export const BackIcon = (p: IconProps) => <Icon d="M19 12H5m6-6-6 6 6 6" {...p} />;
export const ChevronLeftIcon = (p: IconProps) => <Icon d="m15 5-7 7 7 7" {...p} />;
export const ChevronRightIcon = (p: IconProps) => <Icon d="m9 5 7 7-7 7" {...p} />;
export const ExpandIcon = (p: IconProps) => <Icon d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" {...p} />;
export const ExternalIcon = (p: IconProps) => (
  <Icon d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" {...p} />
);
export const PauseIcon = (p: IconProps) => <Icon d="M9 5v14M15 5v14" {...p} />;
export const PlayIcon = (p: IconProps) => <Icon d="M7 5v14l12-7z" {...p} />;
export const CopyIcon = (p: IconProps) => <Icon d="M9 9h11v11H9zM15 9V4H4v11h5" {...p} />;
export const LockIcon = (p: IconProps) => <Icon d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" {...p} />;
export const GlobeIcon = (p: IconProps) => (
  <Icon
    d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9s1.2-6.4 3.6-9z"
    {...p}
  />
);
export const ClockIcon = (p: IconProps) => <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" {...p} />;
export const AlertIcon = (p: IconProps) => <Icon d="M12 8v5M12 16.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" {...p} />;
export const ZapIcon = (p: IconProps) => <Icon d="M13 2 4 14h7l-1 8 9-12h-7z" {...p} />;
export const SpinnerIcon = (p: IconProps) => <Icon d="M21 12a9 9 0 1 1-6.2-8.56" {...p} />;
export const SearchIcon = (p: IconProps) => <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35" {...p} />;
export const ListIcon = (p: IconProps) => <Icon d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" {...p} />;
export const GridIcon = (p: IconProps) => <Icon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" {...p} />;
export const BellIcon = (p: IconProps) => (
  <Icon d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" {...p} />
);
export const TrashIcon = (p: IconProps) => <Icon d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" {...p} />;
export const PlusIcon = (p: IconProps) => <Icon d="M12 5v14M5 12h14" {...p} />;
export const TextIcon = (p: IconProps) => <Icon d="M4 6h16M4 12h16M4 18h10" {...p} />;
export const DeviceIcon = (p: IconProps) => (
  <Icon d="M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2" {...p} />
);
export const LinkIcon = (p: IconProps) => (
  <Icon
    d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"
    {...p}
  />
);
export const QrIcon = (p: IconProps) => (
  <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" {...p} />
);

const FileIcon = (p: IconProps) => (
  <Icon d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5" {...p} />
);
const ImageIcon = (p: IconProps) => <Icon d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01" {...p} />;
const VideoIcon = (p: IconProps) => <Icon d="M3 6h12v12H3zM15 10l6-3.5v11L15 14" {...p} />;
const AudioIcon = (p: IconProps) => (
  <Icon d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" {...p} />
);
const ArchiveIcon = (p: IconProps) => <Icon d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" {...p} />;

const FILE_TYPES: [RegExp, (p: IconProps) => ReactNode][] = [
  [/\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|svg|tiff?|dng|cr2|nef|arw)$/i, ImageIcon],
  [/\.(mp4|mov|mkv|avi|webm|m4v|wmv|3gp)$/i, VideoIcon],
  [/\.(mp3|flac|wav|aac|ogg|m4a|opus)$/i, AudioIcon],
  [/\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst|iso)$/i, ArchiveIcon],
];

export function FileTypeIcon({ path, className }: IconProps & { path: string }) {
  const Match = FILE_TYPES.find(([pattern]) => pattern.test(path))?.[1] ?? FileIcon;
  return <Match className={className} />;
}

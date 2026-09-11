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

export const LogoIcon = (p: IconProps) => <Icon d="M5 9h14m-4-4 4 4-4 4M19 15H5m4 4-4-4 4-4" {...p} />;
export const UploadIcon = (p: IconProps) => <Icon d="M12 15V3m0 0L7 8m5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" {...p} />;
export const DownloadIcon = (p: IconProps) => <Icon d="M12 3v12m0 0-5-5m5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" {...p} />;
export const CloseIcon = (p: IconProps) => <Icon d="M6 6l12 12M18 6 6 18" {...p} />;
export const RetryIcon = (p: IconProps) => <Icon d="M20 12a8 8 0 1 1-2.34-5.66L20 8.7M20 4v4.7h-4.7" {...p} />;
export const CheckIcon = (p: IconProps) => <Icon d="m5 12.5 4.5 4.5L19 7" {...p} />;
export const FolderIcon = (p: IconProps) => <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" {...p} />;
export const ArrowIcon = (p: IconProps) => <Icon d="M5 12h14m-6-6 6 6-6 6" {...p} />;
export const PauseIcon = (p: IconProps) => <Icon d="M9 5v14M15 5v14" {...p} />;
export const PlayIcon = (p: IconProps) => <Icon d="M7 5v14l12-7z" {...p} />;
export const LinkIcon = (p: IconProps) => (
  <Icon d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" {...p} />
);
export const QrIcon = (p: IconProps) => (
  <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" {...p} />
);

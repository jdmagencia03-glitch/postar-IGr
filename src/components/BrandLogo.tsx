type BrandLogoProps = {
  className?: string;
  accentClassName?: string;
  compact?: boolean;
};

export function BrandLogo({
  className,
  accentClassName = "text-ig-primary",
  compact = false,
}: BrandLogoProps) {
  const base =
    className ??
    (compact
      ? "text-base font-semibold tracking-tight text-ig-text"
      : "text-[22px] font-normal tracking-tight text-ig-muted");

  return (
    <span className={base}>
      <span className="font-medium text-ig-text">JDM</span>{" "}
      <span className={accentClassName}>Hub</span>
    </span>
  );
}

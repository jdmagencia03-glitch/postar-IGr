type BrandLogoProps = {
  className?: string;
  accentClassName?: string;
};

export function BrandLogo({
  className = "ig-brand-script text-2xl leading-none text-ig-text sm:text-3xl",
  accentClassName = "ig-brand-gradient",
}: BrandLogoProps) {
  return (
    <span className={className}>
      JDM <span className={accentClassName}>Hub</span>
    </span>
  );
}

'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as React from 'react';

import { cn } from '@/lib/cn';
import { applyCloudflarePath } from '@/lib/images';
import { getDicebearAvatar } from '@/lib/avatar';

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full',
      className,
    )}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> & {
    width?: number;
    seed?: string | number;
  }
>(({ className, src, seed, width, onError, ...props }, ref) => {
  const fallbackSrc = React.useMemo(
    () => getDicebearAvatar(seed ?? props.alt),
    [seed, props.alt]
  );
  const optimizedSrc = React.useMemo(() => {
    if (!src) return fallbackSrc;
    if (!width) return src;
    return applyCloudflarePath({ url: src, width }) ?? src;
  }, [src, width, fallbackSrc]);
  const [resolvedSrc, setResolvedSrc] = React.useState(optimizedSrc);

  React.useEffect(() => {
    setResolvedSrc(optimizedSrc);
  }, [optimizedSrc]);

  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn('aspect-square h-full w-full', className)}
      src={resolvedSrc}
      onError={(event) => {
        if (resolvedSrc !== fallbackSrc) {
          setResolvedSrc(fallbackSrc);
        }
        onError?.(event);
      }}
      {...props}
    />
  );
});
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center rounded-full bg-muted',
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarFallback, AvatarImage };

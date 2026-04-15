import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.JSX.Element => (
  <DialogPrimitive.Overlay
    data-slot="dialog-overlay"
    className={cn(
      // `data-[state=closed]:opacity-0 pointer-events-none` keeps the overlay
      // invisible and click-through when the dialog is force-mounted but closed.
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 data-[state=closed]:opacity-0 data-[state=closed]:pointer-events-none',
      className
    )}
    {...props}
  />
)

const DialogContent = ({
  className,
  children,
  forceMount,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>): React.JSX.Element => (
  <DialogPortal forceMount={forceMount}>
    <DialogOverlay forceMount={forceMount} />
    <DialogPrimitive.Content
      forceMount={forceMount}
      data-slot="dialog-content"
      className={cn(
        // `data-[state=closed]:opacity-0 pointer-events-none` hides the
        // content when the dialog is force-mounted but closed.
        'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-md data-[state=closed]:opacity-0 data-[state=closed]:pointer-events-none',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
        <XIcon />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
)

const DialogHeader = ({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element => (
  <div
    data-slot="dialog-header"
    className={cn('flex flex-col gap-1.5 text-center sm:text-left', className)}
    {...props}
  />
)

const DialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>): React.JSX.Element => (
  <DialogPrimitive.Title
    data-slot="dialog-title"
    // `pr-8` keeps multi-line titles from running under the close button.
    // `leading-snug` gives wrapped titles room to breathe instead of the
    // cramped look of `leading-none`.
    className={cn('pr-8 text-lg leading-snug font-semibold', className)}
    {...props}
  />
)

const DialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>): React.JSX.Element => (
  <DialogPrimitive.Description
    data-slot="dialog-description"
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
)

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}

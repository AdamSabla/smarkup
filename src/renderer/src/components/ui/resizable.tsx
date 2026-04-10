import * as React from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { cn } from '@/lib/utils'

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof Group> & {
  direction?: 'horizontal' | 'vertical'
}): React.JSX.Element => {
  // Accept shadcn-style `direction` prop, translate to v4 `orientation`
  const { direction, orientation, ...rest } = props as typeof props & {
    direction?: 'horizontal' | 'vertical'
  }
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full', className)}
      orientation={direction ?? orientation ?? 'horizontal'}
      {...rest}
    />
  )
}

const ResizablePanel = ({ ...props }: React.ComponentProps<typeof Panel>): React.JSX.Element => (
  <Panel data-slot="resizable-panel" {...props} />
)

const ResizableHandle = ({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): React.JSX.Element => (
  <Separator
    data-slot="resizable-handle"
    className={cn(
      'bg-border relative flex w-px items-center justify-center',
      'after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2',
      'focus-visible:ring-ring focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden',
      'hover:bg-ring/40',
      className
    )}
    {...props}
  />
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }

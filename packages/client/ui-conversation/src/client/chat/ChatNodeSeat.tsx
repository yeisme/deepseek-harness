import { memo, useMemo, type MouseEvent } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

function callById(block: ToolCallBlock, callId: string): ToolCallBlock | undefined {
  if (block.callId === callId) return block
  for (const child of block.subCalls) {
    const found = callById(child, callId)
    if (found !== undefined) return found
  }
  return undefined
}

function callName(block: ToolCallBlock): string {
  return 'kind' in block ? block.call?.name ?? block.callId : block.name
}

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, selectedCallId, openDetails, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, fileMentions, useSession, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node as ChatNode | undefined
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      openDetails,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      renderMessageImages,
      fileMentions,
    }, [
    node, selectedCallId, openDetails, cwd, openFile, inspectCall, forkAt, renderMessageImages, fileMentions,
  ])
  if (routedNode === undefined || owner === null) return null
  const revealDetails = (event: MouseEvent<HTMLDivElement>): void => {
    if (routedNode.kind !== 'tool-call' || openDetails === undefined) return
    const target = event.target
    if (!(target instanceof Element) || target.closest('button,a,input,textarea,select') !== null) return
    const callId = target.closest<HTMLElement>('[data-chat-call-id]')?.dataset.chatCallId
      ?? routedNode.data.root.callId
    const block = callById(routedNode.data.root, callId) ?? routedNode.data.root
    openDetails({ turnSeq: routedNode.anchorSeq, callId: block.callId, toolName: callName(block) })
  }
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      onClick={revealDetails}
    >
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})

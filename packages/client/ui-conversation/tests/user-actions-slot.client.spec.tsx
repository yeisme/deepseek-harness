// @vitest-environment jsdom
// Focused coverage for the `conversation.chat.user-actions` slot: the render
// site lives in UserMessageNodeView's IconActions row, the owner addresses a
// plain user node by `seq` alone and an admitted steering node by
// `messageId` + `seq`, and an empty contributor list renders nothing without
// disturbing the built-in copy/clock chrome.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, UserActionOwnerProps } from '../src/client/contract/slots.ts'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import { zh } from '../src/client/locales.ts'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t: ChatNodeViewProps['t'] = makeTranslate(zh, commonZh)
const renderMessageImages: ChatNodeViewProps['renderMessageImages'] = () => null
const emptyUserActions: PropsRenderSlots<'conversation.chat.user-actions'>['renderSlot'] = () => null

/** Chat-view node envelope over a raw conversation node, mirroring the fixture adapters. */
function viewNodeOf(data: Record<string, unknown>): ChatNodeViewProps<'user' | 'steering'>['node'] {
  return {
    key: `fixture:${String(data.kind)}:${String(data.seq)}`,
    kind: data.kind,
    id: String(data.seq),
    target: 'chat',
    anchorSeq: data.seq,
    location: { kind: 'session' },
    visibility: 'visible',
    data,
  } as unknown as ChatNodeViewProps<'user' | 'steering'>['node']
}

const userNode = viewNodeOf({
  kind: 'user',
  seq: 7,
  time: 1_000,
  content: [{ type: 'text', text: 'hello there' }],
  source: null,
})

const steeringNode = viewNodeOf({
  kind: 'steering',
  messageId: 'msg-42',
  seq: 9,
  time: 2_000,
  content: [{ type: 'text', text: 'steered mid-turn' }],
  source: null,
})

describe('conversation.chat.user-actions slot', () => {
  it('renders contributed actions inside the user bubble actions row', () => {
    const owners: UserActionOwnerProps[] = []
    const renderSlot: PropsRenderSlots<'conversation.chat.user-actions'>['renderSlot'] = (key, owner) => {
      expect(key).toBe('conversation.chat.user-actions')
      owners.push(owner as unknown as UserActionOwnerProps)
      return <button type="button" data-user-action-edit>编辑</button>
    }
    render(
      <UserMessageNodeView
        node={userNode}
        renderMessageImages={renderMessageImages}
        t={t}
        renderSlot={renderSlot}
      />,
    )
    expect(owners).toEqual([{ seq: 7 }])
    expect(screen.getByText('编辑')).toBeTruthy()
    // Built-in chrome remains alongside the contributed action.
    expect(screen.getByText('hello there')).toBeTruthy()
  })

  it('addresses admitted steering by messageId and seq', () => {
    const owners: UserActionOwnerProps[] = []
    const renderSlot: PropsRenderSlots<'conversation.chat.user-actions'>['renderSlot'] = (_key, owner) => {
      owners.push(owner as unknown as UserActionOwnerProps)
      return null
    }
    render(
      <UserMessageNodeView
        node={steeringNode}
        renderMessageImages={renderMessageImages}
        t={t}
        renderSlot={renderSlot}
      />,
    )
    expect(owners).toEqual([{ messageId: 'msg-42', seq: 9 }])
  })

  it('renders no extra action markup when no contributor declares one', () => {
    const view = render(
      <UserMessageNodeView
        node={userNode}
        renderMessageImages={renderMessageImages}
        t={t}
        renderSlot={emptyUserActions}
      />,
    )
    expect(view.container.querySelector('[data-user-action-edit]')).toBeNull()
    expect(screen.getByText('hello there')).toBeTruthy()
  })
})

import { Copy, Edit3, KeyRound, LockKeyhole, Plus, RefreshCcw, Save, Trash2, UnlockKeyhole } from 'lucide-react';

export function noteContextMenu(event, note, actions) {
  const command = callback => () => { actions.close(); void callback(); };
  const items = [
    { id: 'new', label: '새 메모', icon: Plus, onClick: command(actions.create) },
    { id: 'refresh', label: '새로고침', icon: RefreshCcw, onClick: command(actions.refresh) }
  ];
  if (note) items.splice(1, 0,
    { id: 'separator', separator: true },
    { id: 'rename', label: '이름 변경', icon: Edit3, onClick: command(() => actions.rename(note)) },
    { id: 'copy', label: '복제', icon: Copy, onClick: command(() => actions.duplicate(note)) },
    { id: 'save', label: '저장', icon: Save, disabled: actions.saving || (note.passwordProtected && !note.passwordUnlocked), onClick: command(() => actions.save(note)) },
    { id: 'password', label: note.passwordProtected ? '암호 변경' : '암호 설정', icon: LockKeyhole, onClick: command(() => actions.setPassword(note)) },
    { id: 'unlock', label: '암호 입력', icon: UnlockKeyhole, disabled: !note.passwordProtected || note.passwordUnlocked, onClick: command(() => actions.unlock(note)) },
    { id: 'clear', label: '암호 해제', icon: UnlockKeyhole, disabled: !note.passwordProtected, onClick: command(() => actions.clearPassword(note)) },
    ...(actions.isAdmin ? [{ id: 'reset', label: '2차 암호 초기화', icon: KeyRound, disabled: !note.passwordProtected, onClick: command(() => actions.resetPassword(note)) }] : []),
    { id: 'separator-delete', separator: true },
    { id: 'delete', label: '삭제', icon: Trash2, onClick: command(() => actions.remove(note)) }
  );
  return { x: Math.max(8, Math.min(event.clientX, window.innerWidth - 228)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)), items };
}

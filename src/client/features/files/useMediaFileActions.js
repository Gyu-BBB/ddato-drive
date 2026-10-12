import { Copy, Download, Edit3, Expand, FolderOpen, KeyRound, LockKeyhole, MoveRight, Share2, Trash2, UnlockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { filesApi } from './filesApi.js';
import { startDownload } from './downloadTransfers.js';
import { adminApi } from '../admin/adminApi.js';

export function useMediaFileActions({ onChanged, onError, onOpenLocation, onOpenFullscreen, isAdmin = false }) {
  const [menu, setMenu] = useState(null);
  const [shareFiles, setShareFiles] = useState([]);
  const [moveFiles, setMoveFiles] = useState([]);
  const [passwordDialog, setPasswordDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const closeMenu = () => setMenu(null);

  function password(options) {
    return new Promise(resolve => setPasswordDialog({ ...options, resolve }));
  }
  function finishPassword(value = '') {
    passwordDialog?.resolve(value);
    setPasswordDialog(null);
  }
  async function unlocked(file) {
    if (!file.passwordProtected || file.passwordUnlocked) return file;
    const value = await password({ title: '암호 입력', body: `${file.name}의 암호를 입력하세요.`, confirmLabel: '잠금 해제' });
    if (!value) return null;
    const result = await filesApi.unlock(file.id, value);
    return result.file;
  }
  async function run(action, refresh = true) {
    setBusy(true);
    onError('');
    try {
      const result = await action();
      if (refresh) await onChanged();
      return result;
    } catch (error) {
      onError(error.message || '파일 작업을 처리하지 못했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openMenu(event, file) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const command = action => () => { closeMenu(); void run(action); };
    const protectedCommand = action => command(async () => {
      const target = await unlocked(file);
      if (target) return action(target);
    });
    setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 228)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360)), items: [
        { id: 'view', label: '전체 화면', icon: Expand, onClick: () => { closeMenu(); onOpenFullscreen(file); } },
        { id: 'location', label: '해당 폴더로 이동', icon: FolderOpen, onClick: () => { closeMenu(); onOpenLocation?.(file); } },
        { id: 'download', label: '다운로드', icon: Download, onClick: protectedCommand(target => startDownload(filesApi.downloadUrl(target.id), target.name)) },
        { id: 'share', label: '공유', icon: Share2, onClick: protectedCommand(target => setShareFiles([target])) },
        { id: 'duplicate', label: '복제', icon: Copy, onClick: protectedCommand(target => filesApi.duplicate(target.id)) },
        { id: 'move', label: '이동...', icon: MoveRight, onClick: protectedCommand(target => setMoveFiles([target])) },
        { id: 'rename', label: '이름 변경', icon: Edit3, onClick: protectedCommand(target => {
          const name = window.prompt('새 이름', target.name);
          if (name && name !== target.name) return filesApi.rename(target.id, name);
        }) },
        { id: 'separator', separator: true },
        { id: 'password', label: file.ownPasswordProtected ? '암호 변경' : '암호 설정', icon: LockKeyhole, onClick: protectedCommand(async target => {
          const value = await password({ title: '암호 설정', body: `${target.name}에 사용할 암호를 입력하세요.`, confirmLabel: '암호 설정' });
          if (value) return filesApi.setPassword(target.id, value);
        }) },
        { id: 'unlock', label: '암호 입력', icon: UnlockKeyhole, disabled: !file.passwordProtected || file.passwordUnlocked, onClick: protectedCommand(() => {}) },
        { id: 'clear', label: '암호 해제', icon: UnlockKeyhole, disabled: !file.ownPasswordProtected, onClick: command(async () => {
          const value = await password({ title: '암호 해제', body: `${file.name}의 현재 암호를 입력하세요.`, confirmLabel: '암호 해제' });
          if (value) return filesApi.clearPassword(file.id, value);
        }) },
        ...(isAdmin ? [{ id: 'reset', label: '2차 암호 초기화', icon: KeyRound, disabled: !file.ownPasswordProtected, onClick: command(() => {
          if (window.confirm(`${file.name}의 2차 암호를 초기화할까요?`)) return adminApi.resetFilePassword(file.id);
        }) }] : []),
        { id: 'separator-delete', separator: true },
        { id: 'delete', label: '삭제', icon: Trash2, onClick: command(() => {
          if (window.confirm(`${file.name}을 삭제할까요?`)) return filesApi.remove(file.id);
        }) }
      ] });
  }

  async function move(parentId) {
    return run(async () => {
      if (parentId) {
        const result = await filesApi.get(parentId);
        if (!(await unlocked(result.file))) return false;
      }
      for (const file of moveFiles) await filesApi.move(file.id, parentId);
      setMoveFiles([]);
      return true;
    });
  }

  return { menu, closeMenu, openMenu, busy, shareFiles, closeShare: () => setShareFiles([]), moveFiles,
    closeMove: () => setMoveFiles([]), move, passwordDialog, finishPassword,
    hasOverlay: Boolean(menu || shareFiles.length || moveFiles.length || passwordDialog) };
}

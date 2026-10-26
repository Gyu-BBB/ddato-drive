import { useEffect, useState } from 'react';
import { fetchHeicPreview, isHeicName } from './heicPreview.js';

export function useCompatibleImage(src, name) {
  const needsConversion = Boolean(src && !src.startsWith('blob:') && isHeicName(name));
  const [state, setState] = useState({ source: '', url: '', error: '' });
  useEffect(() => {
    if (!needsConversion) return;
    const controller = new AbortController(); let url = '';
    setState({ source: src, url: '', error: '' });
    fetchHeicPreview(src, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setState({ source: src, url, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setState({ source: src, url: '', error: error.message || 'HEIC 미리보기 생성 실패' }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src, name, needsConversion]);
  return needsConversion ? state.source === src ? state : { url: '', error: '' } : { url: src, error: '' };
}
